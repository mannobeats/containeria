//! The engine process: owns the VM, Docker's socket on the Mac and the ports containers publish.
//!
//! It runs from the first start until it is asked to stop. In between the VM is either on or,
//! when nothing runs in it, off (`Asleep`): the next connection to Docker's socket boots it again,
//! which takes about a second.

mod changes;
mod guest;
mod kube;
mod kubeconfig;
mod memory;
mod ports;
mod proxy;
mod reach;
mod server;
mod vmm;

use std::fs;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::{Duration, Instant};

use containeria_proto::{EngineCall, Stats};
use tokio::net::UnixListener;
use tokio::signal::unix::{SignalKind, signal};
use tokio::sync::{mpsc, watch};

use self::guest::{Guest, Paths};
use self::ports::Ports;
use self::proxy::Use;
use crate::api::{ClusterState, MemoryUse, Phase, Status, Vm};
use crate::config::EngineConfig;
use crate::error::{Error, Result};
use crate::home::Home;

/// How often the engine looks at the guest: to size its memory and to see whether it idles.
const TICK: Duration = Duration::from_secs(2);
/// How far the guest's clock may be from the Mac's before it is set again.
const CLOCK_SLACK_MILLIS: u64 = 1000;
/// Docker gets this long to stop its containers before the power is cut.
const SHUTDOWN_PATIENCE: Duration = Duration::from_secs(45);

fn unix_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |now| u64::try_from(now.as_millis()).unwrap_or(u64::MAX))
}

/// Whether Docker is being spoken to: when bytes last moved on its socket, and how many requests
/// still wait for their answer.
#[derive(Debug)]
pub(crate) struct Activity {
    last: Mutex<Instant>,
    waiting: AtomicUsize,
}

impl Activity {
    fn new() -> Self {
        Self { last: Mutex::new(Instant::now()), waiting: AtomicUsize::new(0) }
    }

    pub(crate) fn touch(&self) {
        *self.last.lock().unwrap_or_else(PoisonError::into_inner) = Instant::now();
    }

    /// A request was sent whose answer hasn't started. Until [`Self::answered`], the engine is
    /// in use however long that takes: a pull waiting on a slow registry moves no bytes.
    pub(crate) fn asked(&self) {
        self.waiting.fetch_add(1, Ordering::Relaxed);
    }

    pub(crate) fn answered(&self) {
        self.waiting.fetch_sub(1, Ordering::Relaxed);
        self.touch();
    }

    fn quiet_for(&self, time: Duration) -> bool {
        self.waiting.load(Ordering::Relaxed) == 0
            && self.last.lock().unwrap_or_else(PoisonError::into_inner).elapsed() >= time
    }
}

/// Keeps the VM awake until dropped.
#[derive(Debug)]
pub(crate) struct Hold(Arc<Engine>);

impl Drop for Hold {
    fn drop(&mut self) {
        self.0.holds.fetch_sub(1, Ordering::Relaxed);
        self.0.activity.touch();
    }
}

#[derive(Debug)]
pub(crate) struct Engine {
    paths: Paths,
    phase: watch::Sender<(Phase, Option<String>)>,
    /// The running guest. Held across a boot and a shutdown, so a wake waits for either to end.
    guest: tokio::sync::Mutex<Option<Arc<Guest>>>,
    ports: Arc<Ports>,
    activity: Activity,
    holds: AtomicUsize,
    memory: Mutex<Option<MemoryUse>>,
    kubernetes: Mutex<ClusterState>,
    /// Where the cluster's API answers on the Mac, while it has a port there.
    kubernetes_port: Mutex<Option<containeria_proto::Port>>,
    /// Held while the cluster starts, stops or resets, so those happen one at a time.
    changing_kubernetes: tokio::sync::Mutex<()>,
}

impl Engine {
    fn new(paths: Paths) -> Arc<Self> {
        Arc::new(Self {
            paths,
            phase: watch::Sender::new((Phase::Starting, None)),
            guest: tokio::sync::Mutex::new(None),
            ports: Arc::default(),
            activity: Activity::new(),
            holds: AtomicUsize::new(0),
            memory: Mutex::new(None),
            kubernetes: Mutex::new(ClusterState::Off),
            kubernetes_port: Mutex::new(None),
            changing_kubernetes: tokio::sync::Mutex::new(()),
        })
    }

    pub(crate) fn status(&self) -> Status {
        let (phase, problem) = self.phase.borrow().clone();
        let vm = self.running().filter(|_| phase == Phase::Running).and_then(|guest| {
            let memory = (*self.memory.lock().unwrap_or_else(PoisonError::into_inner))?;
            Some(Vm { cpus: guest.cpus, memory, kernel: guest.kernel.clone() })
        });
        let kubernetes = self.kubernetes.lock().unwrap_or_else(PoisonError::into_inner).clone();
        Status { phase, problem, vm, kubernetes }
    }

    /// The guest, when the VM runs and is neither starting nor shutting down.
    pub(crate) fn running(&self) -> Option<Arc<Guest>> {
        self.guest.try_lock().ok()?.clone()
    }

    pub(crate) fn hold(self: &Arc<Self>) -> Hold {
        self.holds.fetch_add(1, Ordering::Relaxed);
        Hold(Arc::clone(self))
    }

    /// The running guest, booting the VM first when it is off.
    pub(crate) async fn wake(self: &Arc<Self>) -> Result<Arc<Guest>> {
        let mut guest = self.guest.lock().await;
        if let Some(guest) = guest.as_ref() {
            return Ok(Arc::clone(guest));
        }
        if self.phase.borrow().0 == Phase::Stopped {
            return Err(Error::Stopped);
        }
        self.set(Phase::Starting, None);
        let config = EngineConfig::load(&self.paths.home.config_file())?.unwrap_or_default();
        let started = Instant::now();
        match guest::boot(&self.paths, &config, &self.ports).await {
            Ok(booted) => {
                tracing::info!(kernel = booted.kernel, "the VM started in {:?}", started.elapsed());
                let booted = Arc::new(booted);
                let ceiling = config.memory_bytes();
                *self.memory.lock().unwrap_or_else(PoisonError::into_inner) = Some(MemoryUse {
                    ceiling_bytes: ceiling,
                    allowed_bytes: ceiling,
                    used_bytes: 0,
                });
                *guest = Some(Arc::clone(&booted));
                self.activity.touch();
                self.set(Phase::Running, None);
                if config.kubernetes.enabled {
                    let (engine, guest) = (Arc::clone(self), Arc::clone(&booted));
                    let version = config.kubernetes.version.clone();
                    tokio::spawn(async move {
                        let _ = engine.run_kubernetes(&guest, &version, false).await;
                    });
                }
                tokio::spawn(Arc::clone(self).tend(Arc::clone(&booted), config));
                Ok(booted)
            }
            Err(error) => {
                tracing::error!("the VM didn't start: {error}");
                self.set(Phase::Failed, Some(error.to_string()));
                Err(error)
            }
        }
    }

    /// Looks after a running guest until it is gone: keeps its memory near what it uses, turns
    /// the VM off when it idles, and notices when it stops by itself.
    async fn tend(self: Arc<Self>, guest: Arc<Guest>, config: EngineConfig) {
        let ceiling = config.memory_bytes();
        let idle = Duration::from_secs(u64::from(config.idle_seconds));
        let mut allowed = ceiling;
        // A guest that just booted holds no file cache worth keeping: size it in one step.
        if let Ok(stats) = guest.agent.call::<_, Stats>(&EngineCall::Stats).await {
            let fitted = memory::settled(&stats, ceiling);
            if guest.vmm.balloon(fitted).await.is_ok() {
                allowed = fitted;
            }
        }
        loop {
            tokio::select! {
                () = tokio::time::sleep(TICK) => {}
                reason = guest.vmm.off() => return self.lost(&guest, reason).await,
            }
            let Ok(stats) = guest.agent.call::<_, Stats>(&EngineCall::Stats).await else {
                continue;
            };
            // The guest's clock stands still while the Mac sleeps.
            let unix_millis = unix_millis();
            if unix_millis.abs_diff(stats.unix_millis) > CLOCK_SLACK_MILLIS {
                let _ = guest.agent.call::<_, ()>(&EngineCall::SetClock { unix_millis }).await;
            }
            let next = memory::allowance(&stats, allowed, ceiling);
            if next != allowed && guest.vmm.balloon(next).await.is_ok() {
                allowed = next;
            }
            let used = MemoryUse {
                ceiling_bytes: ceiling,
                allowed_bytes: allowed,
                used_bytes: stats.memory_used(),
            };
            *self.memory.lock().unwrap_or_else(PoisonError::into_inner) = Some(used);
            // A cluster that is on is in use, also while it starts and has no pods yet.
            let cluster_off = *self.kubernetes.lock().unwrap_or_else(PoisonError::into_inner)
                == ClusterState::Off;
            let unused = !stats.busy
                && cluster_off
                && self.holds.load(Ordering::Relaxed) == 0
                && self.activity.quiet_for(idle);
            if config.sleep_when_idle && unused {
                tracing::info!("nothing runs and nobody asks: turning the VM off");
                return self.power_down(Phase::Asleep).await;
            }
        }
    }

    /// Starts the cluster with the saved settings and makes it `kubectl`'s current one.
    pub(crate) async fn start_kubernetes(self: &Arc<Self>) -> Result<()> {
        let guest = self.wake().await?;
        let config = EngineConfig::load(&self.paths.home.config_file())?.unwrap_or_default();
        self.run_kubernetes(&guest, &config.kubernetes.version, true).await
    }

    /// Runs k3s `version` in `guest`. `select` makes the cluster `kubectl`'s current one, as
    /// turning Kubernetes on does and a restart of the engine doesn't.
    async fn run_kubernetes(&self, guest: &Guest, version: &str, select: bool) -> Result<()> {
        let _changing = self.changing_kubernetes.lock().await;
        self.set_kubernetes(ClusterState::Starting);
        let published = *self.kubernetes_port.lock().unwrap_or_else(PoisonError::into_inner);
        match kube::start(guest, &self.ports, published, version, select).await {
            Ok(port) => {
                *self.kubernetes_port.lock().unwrap_or_else(PoisonError::into_inner) = Some(port);
                self.set_kubernetes(ClusterState::Running);
                Ok(())
            }
            Err(error) => {
                tracing::error!("Kubernetes didn't start: {error}");
                self.set_kubernetes(ClusterState::Failed(error.to_string()));
                Err(error)
            }
        }
    }

    /// Stops the cluster. The guest is asked before the lock is taken: that ends a start in
    /// progress, which holds the lock for as long as k3s takes to answer.
    pub(crate) async fn stop_kubernetes(self: &Arc<Self>) -> Result<()> {
        let Some(guest) = self.running() else { return Ok(()) };
        let stopped = kube::stop(&guest).await;
        let _changing = self.changing_kubernetes.lock().await;
        self.set_kubernetes(ClusterState::Off);
        stopped
    }

    pub(crate) async fn reset_kubernetes(self: &Arc<Self>) -> Result<()> {
        let guest = self.wake().await?;
        kube::forget(&guest).await?;
        let config = EngineConfig::load(&self.paths.home.config_file())?.unwrap_or_default();
        self.run_kubernetes(&guest, &config.kubernetes.version, false).await
    }

    fn set_kubernetes(&self, cluster: ClusterState) {
        if cluster == ClusterState::Off {
            let port = self.kubernetes_port.lock().unwrap_or_else(PoisonError::into_inner).take();
            if let Some(port) = port {
                self.ports.unpublish(&port);
            }
        }
        *self.kubernetes.lock().unwrap_or_else(PoisonError::into_inner) = cluster;
        // Subscribers hear of the cluster as they hear of the engine's phase.
        self.phase.send_modify(|_| {});
    }

    /// The VM went off without being asked to.
    async fn lost(&self, lost: &Arc<Guest>, reason: Option<String>) {
        let mut guest = self.guest.lock().await;
        if !guest.as_ref().is_some_and(|current| Arc::ptr_eq(current, lost)) {
            return;
        }
        *guest = None;
        self.ports.clear();
        self.set_kubernetes(ClusterState::Off);
        let reason = reason.unwrap_or_else(|| "The VM stopped by itself.".to_owned());
        tracing::error!("the VM is gone: {reason}");
        self.set(Phase::Failed, Some(reason));
    }

    /// Stops Docker and its containers, turns the VM off and ends in `phase`.
    async fn power_down(&self, phase: Phase) {
        let mut guest = self.guest.lock().await;
        if let Some(guest) = guest.take() {
            self.ports.clear();
            self.set_kubernetes(ClusterState::Off);
            let asked = guest.agent.call::<_, ()>(&EngineCall::Shutdown).await.is_ok();
            let off = tokio::time::timeout(SHUTDOWN_PATIENCE, guest.vmm.off());
            if !asked || off.await.is_err() {
                tracing::warn!("the guest didn't shut down; cutting its power");
                let _ = guest.vmm.stop().await;
                let _ = tokio::time::timeout(Duration::from_secs(5), guest.vmm.off()).await;
            }
        }
        self.set(phase, None);
    }

    pub(crate) async fn stop(&self) {
        self.set(Phase::Stopping, None);
        self.power_down(Phase::Stopped).await;
    }

    fn set(&self, phase: Phase, problem: Option<String>) {
        self.phase.send_replace((phase, problem));
    }
}

/// Runs the engine until it is asked to stop, by a client or a signal.
///
/// # Errors
/// Fails when another engine already runs from this home, or its sockets can't be made. A VM that
/// doesn't start is not an error here: the engine stays up to say why and to try again.
pub async fn run(home: Home) -> Result<()> {
    fs::create_dir_all(home.run())?;
    let _lock = only_one(&home)?;
    let paths = Paths::locate(home.clone())?;
    let docker = listen(&home.docker_socket())?;
    let watchers = listen(&home.docker_watch_socket())?;
    let inside = listen(&home.inside_socket())?;
    let clients = listen(&home.engine_socket())?;
    let engine = Engine::new(paths);
    let (stopped, mut stop) = mpsc::channel(1);
    tokio::spawn(proxy::serve(docker, Arc::clone(&engine), Use::Work));
    tokio::spawn(proxy::serve(watchers, Arc::clone(&engine), Use::Watch));
    tokio::spawn(proxy::serve(inside, Arc::clone(&engine), Use::Inside));
    tokio::spawn(server::serve(clients, Arc::clone(&engine), stopped));
    // A failed first boot stays as the engine's status; the next start or `docker` call retries.
    let _ = engine.wake().await;

    let mut terminate = signal(SignalKind::terminate())?;
    let mut interrupt = signal(SignalKind::interrupt())?;
    tokio::select! {
        _ = stop.recv() => {}
        _ = terminate.recv() => engine.stop().await,
        _ = interrupt.recv() => engine.stop().await,
    }
    let sockets = [
        home.docker_socket(),
        home.docker_watch_socket(),
        home.inside_socket(),
        home.engine_socket(),
    ];
    for socket in sockets {
        let _ = fs::remove_file(socket);
    }
    Ok(())
}

/// Holds a lock for the life of the process, so two engines never share a home.
fn only_one(home: &Home) -> Result<fs::File> {
    let lock =
        fs::OpenOptions::new().create(true).append(true).open(home.run().join("engine.lock"))?;
    rustix::fs::flock(&lock, rustix::fs::FlockOperation::NonBlockingLockExclusive)
        .map_err(|_| Error::Engine("The engine is already running.".to_owned()))?;
    Ok(lock)
}

/// A socket left by an engine that didn't end cleanly is replaced; the lock says it is gone.
fn listen(socket: &std::path::Path) -> Result<UnixListener> {
    let _ = fs::remove_file(socket);
    Ok(UnixListener::bind(socket)?)
}
