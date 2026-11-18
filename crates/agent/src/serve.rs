//! The agent: answers the engine on the Mac and runs Docker for it.

use std::sync::{Arc, Mutex, OnceLock, PoisonError};

use contena_proto::rpc::{self, Caller, Incoming};
use contena_proto::{
    AgentCall, Boot, Booted, CONTROL_PORT, DOCKER_PORT, EngineCall, FORWARD_PORT, Kubernetes,
};
use tokio::sync::{mpsc, watch};
use tokio_vsock::{VMADDR_CID_ANY, VsockAddr, VsockListener};

use crate::docker::Docker;
use crate::error::{Doing, Error, Result};
use crate::k3s::{self, K3s};
use crate::{mac, publish, relay, system, watching};

/// The engine's end of the control connection, once it has connected.
#[derive(Clone, Default)]
pub(crate) struct Engine(Arc<Mutex<Option<Caller>>>);

impl Engine {
    pub(crate) async fn call(&self, call: AgentCall) -> Result<(), String> {
        let caller = self.0.lock().unwrap_or_else(PoisonError::into_inner).clone();
        let Some(caller) = caller else {
            return Err("The engine on the Mac isn't connected.".to_owned());
        };
        caller.call(&call).await.map_err(|error| error.to_string())
    }
}

struct Agent {
    docker: tokio::sync::Mutex<Option<Docker>>,
    kubernetes: tokio::sync::Mutex<Option<K3s>>,
    engine: Engine,
    /// Where the guest sees the Mac's folders, known once it is booted.
    shares: OnceLock<Arc<[String]>>,
    shutdown: mpsc::Sender<()>,
    /// Counts the times the cluster was asked to stop: by a stop, a reset or a shutdown. A start
    /// in progress ends when it changes, so none of them waits for a start that may take minutes.
    cluster_stops: watch::Sender<u64>,
}

pub(crate) fn run() -> Result<()> {
    tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
        .doing("start the agent")?
        .block_on(serve())
}

async fn serve() -> Result<()> {
    let _dhcp = system::network().await?;
    mac::stand_in().await?;
    let listen = |port| {
        VsockListener::bind(VsockAddr::new(VMADDR_CID_ANY, port))
            .doing(format!("listen on port {port}"))
    };
    let control = listen(CONTROL_PORT)?;
    let engine = Engine::default();
    tokio::spawn(relay::docker(listen(DOCKER_PORT)?));
    tokio::spawn(relay::forward(listen(FORWARD_PORT)?));
    tokio::spawn(publish::listen(publish::bind()?, engine.clone()));

    let (shutdown, mut shutting_down) = mpsc::channel(1);
    let agent = Arc::new(Agent {
        docker: tokio::sync::Mutex::new(None),
        kubernetes: tokio::sync::Mutex::new(None),
        engine: engine.clone(),
        shares: OnceLock::new(),
        shutdown,
        cluster_stops: watch::Sender::new(0),
    });
    loop {
        tokio::select! {
            accepted = control.accept() => {
                let (stream, _) = accepted.doing("accept the engine's connection")?;
                let (reader, writer) = stream.into_split();
                let (caller, calls) = rpc::open(reader, writer);
                *engine.0.lock().unwrap_or_else(PoisonError::into_inner) = Some(caller);
                tokio::spawn(answer(Arc::clone(&agent), calls));
            }
            _ = shutting_down.recv() => break,
        }
    }
    if let Some(kubernetes) = agent.kubernetes.lock().await.take() {
        kubernetes.stop(false).await;
    }
    if let Some(docker) = agent.docker.lock().await.take() {
        docker.stop().await;
    }
    Ok(())
}

async fn answer(agent: Arc<Agent>, mut calls: mpsc::Receiver<Incoming<EngineCall>>) {
    while let Some(incoming) = calls.recv().await {
        let (call, answer) = incoming.split();
        let agent = Arc::clone(&agent);
        tokio::spawn(async move {
            match call {
                EngineCall::Boot(boot) => {
                    answer.send(agent.boot(&boot).await.map_err(|error| error.to_string())).await;
                }
                EngineCall::Stats => answer.send(Ok::<_, String>(system::stats())).await,
                EngineCall::Changed(changes) => {
                    if let Some(shares) = agent.shares.get() {
                        watching::report(changes, Arc::clone(shares)).await;
                    }
                    answer.send(Ok::<_, String>(())).await;
                }
                EngineCall::SetClock { unix_millis } => {
                    let set = system::set_clock(unix_millis);
                    answer.send(set.map_err(|error| error.to_string())).await;
                }
                EngineCall::Kubernetes(Kubernetes::Start { version }) => {
                    let started = agent.kubernetes(&version).await;
                    answer.send(started.map_err(|error| error.to_string())).await;
                }
                EngineCall::Kubernetes(Kubernetes::Stop) => {
                    agent.stop_kubernetes().await;
                    answer.send(Ok::<_, String>(())).await;
                }
                EngineCall::Kubernetes(Kubernetes::Reset) => {
                    agent.stop_kubernetes().await;
                    answer.send(k3s::forget().map_err(|error| error.to_string())).await;
                }
                EngineCall::Shutdown => {
                    agent.cluster_stops.send_modify(|stops| *stops += 1);
                    answer.send(Ok::<_, String>(())).await;
                    let _ = agent.shutdown.send(()).await;
                }
            }
        });
    }
}

impl Agent {
    /// The running cluster's kubeconfig, starting the cluster first when it is off.
    async fn kubernetes(&self, version: &str) -> Result<String> {
        let mut kubernetes = self.kubernetes.lock().await;
        if let Some(running) = kubernetes.as_ref() {
            return Ok(running.kubeconfig.clone());
        }
        let mut stops = self.cluster_stops.subscribe();
        // Dropping a start stops the k3s it began.
        let started = tokio::select! {
            started = K3s::start(version, self.engine.clone()) => started?,
            _ = stops.changed() => {
                return Err(Error::Failed("Kubernetes was stopped while it started.".to_owned()));
            }
        };
        let kubeconfig = started.kubeconfig.clone();
        *kubernetes = Some(started);
        Ok(kubeconfig)
    }

    async fn stop_kubernetes(&self) {
        self.cluster_stops.send_modify(|stops| *stops += 1);
        if let Some(kubernetes) = self.kubernetes.lock().await.take() {
            kubernetes.stop(true).await;
        }
    }

    async fn boot(&self, boot: &Boot) -> Result<Booted> {
        let mut docker = self.docker.lock().await;
        if docker.is_some() {
            return Err(Error::Failed("The guest has already started.".to_owned()));
        }
        system::apply(boot)?;
        // The network first: pulling an image needs it, and so does a datagram for the Mac.
        system::online().await;
        if let Some(mac_on_network) = system::gateway() {
            mac::send_datagrams_to(mac_on_network).await?;
        }
        *docker = Some(Docker::start(&boot.docker).await?);
        let shares = boot.shares.iter().map(|share| share.path.clone());
        let shares: Arc<[String]> =
            shares.chain(boot.aliases.iter().map(|alias| alias.path.clone())).collect();
        tokio::spawn(watching::follow(self.engine.clone(), Arc::clone(&shares)));
        let _ = self.shares.set(shares);
        Ok(Booted { kernel: system::kernel() })
    }
}
