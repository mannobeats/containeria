use std::path::{Path, PathBuf};
use std::pin::pin;
use std::sync::{Mutex, PoisonError};
use std::time::{Duration, Instant};

use containeria_docker::{Compose, Docker, DockerCli};
use containeria_engine::{
    Colima, DockerConfig, EngineConfig, ForeignContext, Home, Instance, InstanceStatus,
    KubernetesAction, LogLine, Profile,
};
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
    /// Colima isn't installed or bundled.
    Missing,
    /// Colima is there but the engine was never created.
    NotCreated,
    Stopped,
    Starting,
    Running,
    Stopping,
    Broken,
    /// `CONTAINERIA_DOCKER_SOCKET` points at another Docker engine.
    External,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EngineStatus {
    pub(crate) phase: EnginePhase,
    pub(crate) instance: Option<Instance>,
    pub(crate) config: EngineConfig,
    pub(crate) returns_memory: bool,
    pub(crate) docker_socket: String,
    /// Set while "Set Docker context" is on and the Docker CLI points at another engine.
    pub(crate) docker_context: Option<ForeignContext>,
}

/// A profile's phase: a start or stop in progress wins over what Colima last reported.
pub(crate) fn phase_of(
    transition: Option<EnginePhase>,
    instance: Option<&Instance>,
) -> EnginePhase {
    match (transition, instance.map(|instance| instance.status)) {
        (Some(transition), _) => transition,
        (None, None) => EnginePhase::NotCreated,
        (None, Some(InstanceStatus::Running)) => EnginePhase::Running,
        (None, Some(InstanceStatus::Stopped)) => EnginePhase::Stopped,
        (None, Some(InstanceStatus::Broken | InstanceStatus::Unknown)) => EnginePhase::Broken,
    }
}

/// Starts the engine as the app opens, at login too, when it was stopped and Settings allow it.
/// An engine never created waits for first launch, and a broken one for the user to see it.
pub(crate) async fn start_with_app(app: AppHandle) {
    let state = app.state::<AppState>();
    if state.engine.is_external() {
        return;
    }
    let Ok((phase, _)) = state.engine.phase().await else { return };
    if !starts_with_app(state.preferences.get().start_engine, phase) {
        return;
    }
    if let Err(error) = state.engine.start(&app, |_| {}).await {
        tracing::warn!("the engine didn't start with the app: {}", error.message);
    }
}

fn starts_with_app(choice: StartEngine, phase: EnginePhase) -> bool {
    choice == StartEngine::WithApp && phase == EnginePhase::Stopped
}

/// The containers engine as the app sees it: Colima for the VM, Docker for what runs inside.
#[derive(Debug)]
pub(crate) struct Engine {
    home: Home,
    colima: Option<Colima>,
    compose: Option<Compose>,
    docker_cli: Option<DockerCli>,
    external_socket: Option<PathBuf>,
    docker: RwLock<Option<Docker>>,
    transition: Mutex<Option<EnginePhase>>,
}

impl Engine {
    const RECONNECT_EVERY: Duration = Duration::from_secs(2);

    /// # Errors
    /// Fails when no home folder can be found.
    /// `tools` is the app bundle's `tools` folder (see `scripts/fetch-tools.sh`); anything missing
    /// from it is looked for in Homebrew and on the `PATH`.
    pub(crate) fn new(tools: Option<&Path>) -> Result<Self> {
        let home = Home::from_env()?;
        let bundled = |name| tools.map(|dir| dir.join(name));
        let colima = Colima::locate(home.clone(), bundled("bin/colima").as_deref()).ok();
        let external_socket = std::env::var_os("CONTAINERIA_DOCKER_SOCKET").map(PathBuf::from);
        let socket = external_socket.clone().unwrap_or_else(|| home.docker_socket());
        let compose = Compose::locate(&socket, bundled("cli-plugins/docker-compose").as_deref());
        let docker_cli = DockerCli::locate(
            &socket,
            bundled("bin/docker").as_deref(),
            bundled("cli-plugins").as_deref(),
            &home.root().join("docker"),
        );
        Ok(Self {
            home,
            colima,
            compose,
            docker_cli,
            external_socket,
            docker: RwLock::new(None),
            transition: Mutex::new(None),
        })
    }

    pub(crate) async fn status(&self) -> Result<EngineStatus> {
        let config = self.config()?;
        let returns_memory = config.vm_type.returns_memory();
        let (phase, instance) = self.phase().await?;
        let docker_socket = self.socket().to_string_lossy().into_owned();
        let docker_context =
            if config.set_docker_context { self.foreign_docker_context().await } else { None };
        Ok(EngineStatus { phase, instance, config, returns_memory, docker_socket, docker_context })
    }

    /// Read on every status refresh, so a context another engine took shows within one. An
    /// unreadable `config.json` is logged rather than failing the engine's status.
    async fn foreign_docker_context(&self) -> Option<ForeignContext> {
        if self.is_external() {
            return None;
        }
        let ours = Profile::Containers.docker_context();
        let found = match DockerConfig::from_env() {
            Ok(config) => config.foreign_context(&ours).await,
            Err(error) => Err(error),
        };
        found.unwrap_or_else(|error| {
            tracing::warn!("the Docker context couldn't be checked: {error}");
            None
        })
    }

    /// Points the Docker CLI back at Containeria's engine. See ADR 4.
    ///
    /// # Errors
    /// Fails when Containeria's context doesn't exist yet or `config.json` can't be written.
    pub(crate) fn use_docker_context() -> Result<()> {
        DockerConfig::from_env()?.use_context(&Profile::Containers.docker_context())?;
        Ok(())
    }

    async fn phase(&self) -> Result<(EnginePhase, Option<Instance>)> {
        if self.external_socket.is_some() {
            let phase = if self.docker().await.is_ok() {
                EnginePhase::External
            } else {
                EnginePhase::Stopped
            };
            return Ok((phase, None));
        }
        let Some(colima) = &self.colima else { return Ok((EnginePhase::Missing, None)) };
        let instance = colima.instance(Profile::Containers).await?;
        Ok((phase_of(self.transition(), instance.as_ref()), instance))
    }

    /// The settings in the containers profile's `colima.yaml`, or the defaults before first start.
    ///
    /// # Errors
    /// Fails when the file exists but can't be read.
    pub(crate) fn config(&self) -> Result<EngineConfig> {
        let path = self.home.config_file(Profile::Containers);
        Ok(EngineConfig::load(&path)?.unwrap_or_default())
    }

    /// Saved now, applied on the next start.
    ///
    /// # Errors
    /// Fails when the file can't be written.
    pub(crate) fn save_config(&self, config: &EngineConfig) -> Result<()> {
        Ok(config.save(&self.home.config_file(Profile::Containers), Profile::Containers)?)
    }

    pub(crate) async fn start(&self, app: &AppHandle, on_line: impl FnMut(LogLine)) -> Result<()> {
        let colima = self.colima()?;
        crate::storage::ensure_data_ready(&self.home)?;
        if EngineConfig::load(&self.home.config_file(Profile::Containers))?.is_none() {
            self.save_config(&EngineConfig::default())?;
        }
        self.transition_while(
            app,
            EnginePhase::Starting,
            colima.start(Profile::Containers, on_line),
        )
        .await?;
        // Colima's `autoActivate` does this too, but only when it finds a `docker` to run.
        if self.config()?.set_docker_context
            && let Err(error) = Self::use_docker_context()
        {
            tracing::warn!("the Docker context wasn't switched to Containeria: {}", error.message);
        }
        EngineChanged.emit(app)?;
        Ok(())
    }

    pub(crate) async fn stop(&self, app: &AppHandle, on_line: impl FnMut(LogLine)) -> Result<()> {
        let colima = self.colima()?;
        self.forget_docker().await;
        self.transition_while(app, EnginePhase::Stopping, colima.stop(Profile::Containers, on_line))
            .await
    }

    /// Deletes the engine's VM with every image, container, volume and the Kubernetes cluster in it.
    /// Its settings stay, so the next start creates a fresh engine the same size.
    pub(crate) async fn delete(&self, app: &AppHandle) -> Result<()> {
        let colima = self.colima()?;
        self.forget_docker().await;
        self.transition_while(
            app,
            EnginePhase::Stopping,
            colima.delete(Profile::Containers, |_| {}),
        )
        .await
    }

    /// Turns k3s on or off inside the running engine and remembers the choice for the next start.
    pub(crate) async fn set_kubernetes(
        &self,
        app: &AppHandle,
        enabled: bool,
        on_line: impl FnMut(LogLine),
    ) -> Result<()> {
        let colima = self.colima()?;
        let mut config = self.config()?;
        config.kubernetes.enabled = enabled;
        self.save_config(&config)?;
        let action = if enabled { KubernetesAction::Start } else { KubernetesAction::Stop };
        let result = colima.kubernetes(action, on_line).await;
        EngineChanged.emit(app)?;
        Ok(result?)
    }

    /// Deletes every Kubernetes object and starts a fresh cluster.
    pub(crate) async fn reset_kubernetes(&self, on_line: impl FnMut(LogLine)) -> Result<()> {
        Ok(self.colima()?.kubernetes(KubernetesAction::Reset, on_line).await?)
    }

    async fn transition_while(
        &self,
        app: &AppHandle,
        phase: EnginePhase,
        work: impl Future<Output = containeria_engine::Result<()>>,
    ) -> Result<()> {
        self.set_transition(Some(phase));
        EngineChanged.emit(app)?;
        let result = work.await;
        self.set_transition(None);
        EngineChanged.emit(app)?;
        Ok(result?)
    }

    /// A connected Docker client, reconnecting if the engine came back.
    ///
    /// # Errors
    /// Fails with `EngineStopped` when the socket is missing or doesn't answer.
    pub(crate) async fn docker(&self) -> Result<Docker> {
        if let Some(docker) = self.docker.read().await.as_ref() {
            return Ok(docker.clone());
        }
        let docker = Docker::connect(&self.socket()).map_err(|_| CommandError::engine_stopped())?;
        docker.ping().await.map_err(|_| CommandError::engine_stopped())?;
        *self.docker.write().await = Some(docker.clone());
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
        &self.home
    }

    /// Colima, unless the app uses another Docker engine, whose disks it doesn't manage.
    pub(crate) fn own_colima(&self) -> Option<&Colima> {
        self.colima.as_ref().filter(|_| !self.is_external())
    }

    /// The Colima release, when Colima is there and answers.
    pub(crate) async fn colima_version(&self) -> Option<String> {
        self.colima.as_ref()?.version().await.ok()
    }

    pub(crate) fn socket(&self) -> PathBuf {
        self.external_socket.clone().unwrap_or_else(|| self.home.docker_socket())
    }

    async fn forget_docker(&self) {
        *self.docker.write().await = None;
    }

    /// Runs for the life of the app: relays Docker events to the UI and notices when the engine
    /// comes and goes.
    pub(crate) async fn watch(&self, app: AppHandle) {
        let mut alerts = Alerts::default();
        loop {
            if let Ok(docker) = self.docker().await {
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

    fn colima(&self) -> Result<&Colima> {
        self.colima
            .as_ref()
            .ok_or_else(|| CommandError::new(ErrorKind::EngineMissing, "Colima isn't installed."))
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

    #[test]
    fn only_a_stopped_engine_starts_with_the_app_and_only_when_allowed() {
        assert!(starts_with_app(StartEngine::WithApp, EnginePhase::Stopped));
        assert!(!starts_with_app(StartEngine::Manually, EnginePhase::Stopped));
        for phase in [EnginePhase::NotCreated, EnginePhase::Broken, EnginePhase::Running] {
            assert!(!starts_with_app(StartEngine::WithApp, phase));
        }
    }
}
