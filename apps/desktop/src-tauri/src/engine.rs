use std::path::{Path, PathBuf};
use std::pin::pin;
use std::sync::{Mutex, PoisonError};
use std::time::{Duration, Instant};

use contena_docker::{Compose, Docker, DockerCli};
use contena_engine::{ClusterState, EngineConfig, Home, Phase, Status, Vm};
use futures::StreamExt;
use serde::Serialize;
use tauri::{AppHandle, Manager};
use tauri_specta::Event;
use tokio::sync::RwLock;

use crate::error::{CommandError, ErrorKind, Result};
use crate::events::{DockerChanged, EngineChanged};
use crate::notifications::{self, Alerts};
use crate::preferences::StartEngine;
use crate::state::AppState;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) enum EnginePhase {
    /// The engine isn't in the app bundle, as in a development build made without it.
    Missing,
    /// The engine was never started: it has no data disk yet.
    NotCreated,
    Stopped,
    Starting,
    Running,
    /// On, with its VM off because nothing runs in it. Showing a window wakes it.
    Asleep,
    Stopping,
    Broken,
    /// `CONTENA_DOCKER_SOCKET` points at another Docker engine.
    External,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EngineStatus {
    pub(crate) phase: EnginePhase,
    /// Why the engine is `Broken`, in its own words.
    pub(crate) problem: Option<String>,
    pub(crate) vm: Option<Vm>,
    pub(crate) kubernetes: ClusterState,
    pub(crate) config: EngineConfig,
    pub(crate) docker_socket: String,
}

/// The `docker` context that points at Contena's engine.
const DOCKER_CONTEXT: &str = "contena";

/// Starts the engine as the app opens, at login too, when it was stopped and Settings allow it.
/// An engine never created waits for first launch, and a broken one for the user to see it.
pub(crate) async fn start_with_app(app: AppHandle) {
    let state = app.state::<AppState>();
    if state.engine.is_external() {
        return;
    }
    let phase = state.engine.phase().await;
    if !starts_with_app(state.preferences.get().start_engine, phase) {
        return;
    }
    if let Err(error) = state.engine.start(&app).await {
        tracing::warn!("the engine didn't start with the app: {}", error.message);
    }
}

fn starts_with_app(choice: StartEngine, phase: EnginePhase) -> bool {
    choice == StartEngine::WithApp && phase == EnginePhase::Stopped
}

/// What the app shows for the engine's own phase. `created` tells an engine that is off from one
/// that was never started.
fn phase_of(transition: Option<EnginePhase>, status: &Status, created: bool) -> EnginePhase {
    match (transition, status.phase) {
        (Some(transition), _) => transition,
        (None, Phase::Stopped) if created => EnginePhase::Stopped,
        (None, Phase::Stopped) => EnginePhase::NotCreated,
        (None, Phase::Starting) => EnginePhase::Starting,
        (None, Phase::Running) => EnginePhase::Running,
        (None, Phase::Asleep) => EnginePhase::Asleep,
        (None, Phase::Stopping) => EnginePhase::Stopping,
        (None, Phase::Failed) => EnginePhase::Broken,
    }
}

/// The containers engine as the app sees it: Contena's own, or another Docker engine named in
/// the environment.
#[derive(Debug)]
pub(crate) struct Engine {
    /// Contena's own engine, used unless another is named in the environment.
    own: contena_engine::Engine,
    compose: Option<Compose>,
    docker_cli: Option<DockerCli>,
    external_socket: Option<PathBuf>,
    docker: RwLock<Option<Docker>>,
    watching: RwLock<Option<Docker>>,
    transition: Mutex<Option<EnginePhase>>,
}

impl Engine {
    const RECONNECT_EVERY: Duration = Duration::from_secs(2);
    /// How often the app looks whether one of its windows shows.
    const LOOK_EVERY: Duration = Duration::from_millis(500);

    /// `resources` is the app bundle's resource folder: `engine` in it holds the engine (see
    /// `scripts/build-engine.sh`) and `tools` the command-line tools (`scripts/fetch-tools.sh`);
    /// a tool missing from it is looked for in Homebrew and on the `PATH`.
    ///
    /// # Errors
    /// Fails when no home folder can be found.
    pub(crate) fn new(resources: Option<&Path>) -> Result<Self> {
        let home = Home::from_env()?;
        let tool = |name| resources.map(|folder| folder.join("tools").join(name));
        let program = resources.map(|folder| folder.join("engine/contena-engine"));
        let external_socket = std::env::var_os("CONTENA_DOCKER_SOCKET").map(PathBuf::from);
        let socket = external_socket.clone().unwrap_or_else(|| home.docker_socket());
        let compose = Compose::locate(&socket, tool("cli-plugins/docker-compose").as_deref());
        let docker_cli = DockerCli::locate(
            &socket,
            tool("bin/docker").as_deref(),
            tool("cli-plugins").as_deref(),
            &home.root().join("docker"),
        );
        Ok(Self {
            own: contena_engine::Engine::locate(home, program.as_deref()),
            compose,
            docker_cli,
            external_socket,
            docker: RwLock::new(None),
            watching: RwLock::new(None),
            transition: Mutex::new(None),
        })
    }

    pub(crate) async fn status(&self) -> Result<EngineStatus> {
        let (phase, status) = self.phase_and_status().await;
        Ok(EngineStatus {
            phase,
            problem: status.problem,
            vm: status.vm,
            kubernetes: status.kubernetes,
            config: self.config()?,
            docker_socket: self.socket().to_string_lossy().into_owned(),
        })
    }

    pub(crate) async fn phase(&self) -> EnginePhase {
        self.phase_and_status().await.0
    }

    async fn phase_and_status(&self) -> (EnginePhase, Status) {
        if self.external_socket.is_some() {
            let answers = self.docker().await.is_ok();
            let phase = if answers { EnginePhase::External } else { EnginePhase::Stopped };
            return (phase, Status::stopped());
        }
        if !self.own.installed() {
            return (EnginePhase::Missing, Status::stopped());
        }
        let status = self.own.status().await;
        (phase_of(self.transition(), &status, self.own.created()), status)
    }

    /// The saved settings, or the defaults before any were saved.
    ///
    /// # Errors
    /// Fails when the file exists but can't be read.
    pub(crate) fn config(&self) -> Result<EngineConfig> {
        Ok(EngineConfig::load(&self.home().config_file())?.unwrap_or_default())
    }

    /// Saved now, applied on the next start.
    ///
    /// # Errors
    /// Fails when the file can't be written.
    pub(crate) fn save_config(&self, config: &EngineConfig) -> Result<()> {
        Ok(config.save(&self.home().config_file())?)
    }

    pub(crate) async fn start(&self, app: &AppHandle) -> Result<()> {
        crate::storage::ensure_data_ready(self.home())?;
        self.transition_while(app, EnginePhase::Starting, self.own.start()).await?;
        if self.config()?.set_docker_context
            && let Some(docker) = &self.docker_cli
            && let Err(error) = docker.select_context(DOCKER_CONTEXT).await
        {
            tracing::warn!(%error, "docker's context wasn't switched to Contena");
        }
        Ok(())
    }

    pub(crate) async fn stop(&self, app: &AppHandle) -> Result<()> {
        self.forget_docker().await;
        self.transition_while(app, EnginePhase::Stopping, self.own.stop()).await
    }

    /// Deletes the engine's data: every image, container, volume and the Kubernetes cluster.
    /// Its settings stay, so the next start creates a fresh engine the same size.
    pub(crate) async fn reset(&self, app: &AppHandle) -> Result<()> {
        self.forget_docker().await;
        self.transition_while(app, EnginePhase::Stopping, self.own.reset()).await
    }

    /// Turns Kubernetes on or off now and for every later start.
    pub(crate) async fn set_kubernetes(&self, app: &AppHandle, enabled: bool) -> Result<()> {
        let mut config = self.config()?;
        config.kubernetes.enabled = enabled;
        self.save_config(&config)?;
        EngineChanged.emit(app)?;
        let result = if enabled {
            self.own.start_kubernetes().await
        } else {
            self.own.stop_kubernetes().await
        };
        EngineChanged.emit(app)?;
        Ok(result?)
    }

    /// Deletes every Kubernetes object and starts a fresh cluster.
    pub(crate) async fn reset_kubernetes(&self, app: &AppHandle) -> Result<()> {
        let result = self.own.reset_kubernetes().await;
        EngineChanged.emit(app)?;
        Ok(result?)
    }

    async fn transition_while(
        &self,
        app: &AppHandle,
        phase: EnginePhase,
        work: impl Future<Output = contena_engine::Result<()>>,
    ) -> Result<()> {
        self.set_transition(Some(phase));
        EngineChanged.emit(app)?;
        let result = work.await;
        self.set_transition(None);
        EngineChanged.emit(app)?;
        Ok(result?)
    }

    /// A connected Docker client, for what the user asks for. Using it tells the engine it is in
    /// use, and wakes its VM when it sleeps; tasks that only watch use [`Self::watching`].
    ///
    /// # Errors
    /// Fails with `EngineStopped` when the socket is missing or doesn't answer.
    pub(crate) async fn docker(&self) -> Result<Docker> {
        Self::connected(&self.docker, &self.socket()).await
    }

    /// A Docker client for the app's own background watching: lists, charts and events. It
    /// answers only while the VM runs and never keeps it awake, so an open app costs nothing when
    /// nothing runs.
    ///
    /// # Errors
    /// Fails with `EngineStopped` while the engine is off or its VM sleeps.
    pub(crate) async fn watching(&self) -> Result<Docker> {
        let socket = match &self.external_socket {
            Some(socket) => socket.clone(),
            None => self.home().docker_watch_socket(),
        };
        Self::connected(&self.watching, &socket).await
    }

    async fn connected(kept: &RwLock<Option<Docker>>, socket: &Path) -> Result<Docker> {
        if let Some(docker) = kept.read().await.as_ref() {
            return Ok(docker.clone());
        }
        let docker = Docker::connect(socket).map_err(|_| CommandError::engine_stopped())?;
        docker.ping().await.map_err(|_| CommandError::engine_stopped())?;
        *kept.write().await = Some(docker.clone());
        Ok(docker)
    }

    /// Docker Compose, pointed at this engine.
    ///
    /// # Errors
    /// Fails with `EngineMissing` when Compose isn't bundled or installed.
    pub(crate) fn compose(&self) -> Result<Compose> {
        self.compose.clone().ok_or_else(|| {
            CommandError::new(
                ErrorKind::EngineMissing,
                "Docker Compose wasn't found. Install it with `brew install docker-compose`.",
            )
        })
    }

    /// The Docker CLI, pointed at this engine, for builds and pushes.
    ///
    /// # Errors
    /// Fails with `EngineMissing` when the CLI isn't bundled or installed.
    pub(crate) fn docker_cli(&self) -> Result<DockerCli> {
        self.docker_cli.clone().ok_or_else(|| {
            CommandError::new(
                ErrorKind::EngineMissing,
                "The Docker command-line tool wasn't found. Install it with `brew install docker`.",
            )
        })
    }

    pub(crate) const fn is_external(&self) -> bool {
        self.external_socket.is_some()
    }

    pub(crate) const fn home(&self) -> &Home {
        self.own.home()
    }

    /// Docker's socket, for the tools that connect to it themselves.
    pub(crate) fn docker_socket(&self) -> PathBuf {
        self.socket()
    }

    fn socket(&self) -> PathBuf {
        self.external_socket.clone().unwrap_or_else(|| self.home().docker_socket())
    }

    async fn forget_docker(&self) {
        *self.docker.write().await = None;
        *self.watching.write().await = None;
    }

    /// Runs for the life of the app: relays Docker events to the UI and notices when the engine
    /// comes and goes. The stream it reads is silent while nothing happens, and ends when the VM
    /// goes to sleep.
    pub(crate) async fn watch(&self, app: AppHandle) {
        let mut alerts = Alerts::default();
        loop {
            if let Ok(docker) = self.watching().await {
                let _ = EngineChanged.emit(&app);
                let mut events = pin!(docker.events());
                while let Some(Ok(event)) = events.next().await {
                    if let Some(alert) = alerts.on_event(&event, Instant::now()) {
                        notifications::send(&app, &alert);
                    }
                    let _ = DockerChanged(event).emit(&app);
                }
                self.forget_docker().await;
                let _ = EngineChanged.emit(&app);
            }
            tokio::time::sleep(Self::RECONNECT_EVERY).await;
        }
    }

    /// Runs for the life of the app: keeps the engine's VM awake while a window shows, so what it
    /// shows is live, and lets it sleep when the app is only in the menu bar.
    pub(crate) async fn stay_awake_while_shown(&self, app: AppHandle) {
        if self.is_external() {
            return;
        }
        let mut hold = None;
        loop {
            let shown =
                app.webview_windows().values().any(|window| window.is_visible().unwrap_or(false));
            if !shown {
                hold = None;
            } else if hold.is_none() {
                hold = self.own.hold().await.ok();
            }
            match &mut hold {
                Some(kept) => {
                    tokio::select! {
                        () = kept.lost() => hold = None,
                        () = tokio::time::sleep(Self::LOOK_EVERY) => {}
                    }
                }
                None => tokio::time::sleep(Self::LOOK_EVERY).await,
            }
        }
    }

    fn transition(&self) -> Option<EnginePhase> {
        *self.transition.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn set_transition(&self, phase: Option<EnginePhase>) {
        *self.transition.lock().unwrap_or_else(PoisonError::into_inner) = phase;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn engine(phase: Phase) -> Status {
        Status { phase, ..Status::stopped() }
    }

    #[test]
    fn a_transition_in_progress_wins_over_what_the_engine_reports() {
        let phase = phase_of(Some(EnginePhase::Stopping), &engine(Phase::Running), true);
        assert_eq!(phase, EnginePhase::Stopping);
    }

    #[test]
    fn an_engine_that_is_off_is_stopped_once_it_has_data() {
        assert_eq!(phase_of(None, &engine(Phase::Stopped), true), EnginePhase::Stopped);
        assert_eq!(phase_of(None, &engine(Phase::Stopped), false), EnginePhase::NotCreated);
    }

    #[test]
    fn a_vm_that_failed_shows_as_broken_and_a_sleeping_one_as_asleep() {
        assert_eq!(phase_of(None, &engine(Phase::Failed), true), EnginePhase::Broken);
        assert_eq!(phase_of(None, &engine(Phase::Asleep), true), EnginePhase::Asleep);
    }

    #[test]
    fn only_a_stopped_engine_starts_with_the_app_and_only_when_allowed() {
        assert!(starts_with_app(StartEngine::WithApp, EnginePhase::Stopped));
        assert!(!starts_with_app(StartEngine::Manually, EnginePhase::Stopped));
        for phase in [EnginePhase::NotCreated, EnginePhase::Broken, EnginePhase::Running] {
            assert!(!starts_with_app(StartEngine::WithApp, phase));
        }
    }
}
