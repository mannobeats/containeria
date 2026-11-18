//! The engine's own socket: where the app and `cx` ask for its status, start and stop it.

use std::sync::Arc;

use containeria_proto::rpc::{self, Caller};
use tokio::net::{UnixListener, UnixStream};
use tokio::sync::mpsc;

use super::Engine;
use crate::api::{ClientCall, EngineNote};

/// Serves clients until one asks the engine to stop, then tells `stopped`.
pub(crate) async fn serve(listener: UnixListener, engine: Arc<Engine>, stopped: mpsc::Sender<()>) {
    while let Ok((client, _)) = listener.accept().await {
        tokio::spawn(answer(client, Arc::clone(&engine), stopped.clone()));
    }
}

async fn answer(client: UnixStream, engine: Arc<Engine>, stopped: mpsc::Sender<()>) {
    let (reader, writer) = client.into_split();
    let (caller, mut calls) = rpc::open::<_, _, ClientCall>(reader, writer);
    // Dropped with this connection, which is what lets the VM sleep again.
    let mut hold = None;
    while let Some(incoming) = calls.recv().await {
        let (call, answer) = incoming.split();
        match call {
            ClientCall::Status => answer.send(Ok::<_, String>(engine.status())).await,
            ClientCall::Start => {
                let engine = Arc::clone(&engine);
                tokio::spawn(async move {
                    let started =
                        engine.wake().await.map(|_| ()).map_err(|error| error.to_string());
                    answer.send(started).await;
                });
            }
            ClientCall::Stop => {
                engine.stop().await;
                answer.send(Ok::<_, String>(())).await;
                let _ = stopped.send(()).await;
            }
            ClientCall::KubernetesStart => {
                let engine = Arc::clone(&engine);
                tokio::spawn(async move {
                    let started = engine.start_kubernetes().await;
                    answer.send(started.map_err(|error| error.to_string())).await;
                });
            }
            ClientCall::KubernetesStop => {
                let engine = Arc::clone(&engine);
                tokio::spawn(async move {
                    let stopped = engine.stop_kubernetes().await;
                    answer.send(stopped.map_err(|error| error.to_string())).await;
                });
            }
            ClientCall::KubernetesReset => {
                let engine = Arc::clone(&engine);
                tokio::spawn(async move {
                    let reset = engine.reset_kubernetes().await;
                    answer.send(reset.map_err(|error| error.to_string())).await;
                });
            }
            ClientCall::Hold => {
                hold.get_or_insert_with(|| engine.hold());
                answer.send(Ok::<_, String>(())).await;
                // Whoever holds the VM awake wants it awake now, not at their next request.
                let engine = Arc::clone(&engine);
                tokio::spawn(async move {
                    let _ = engine.wake().await;
                });
            }
            ClientCall::Subscribe => {
                tokio::spawn(notify(caller.clone(), Arc::clone(&engine)));
                answer.send(Ok::<_, String>(())).await;
            }
        }
    }
}

/// Tells a subscriber each time the engine's phase changes, until it hangs up.
async fn notify(client: Caller, engine: Arc<Engine>) {
    let mut phase = engine.phase.subscribe();
    while phase.changed().await.is_ok() {
        let changed = EngineNote::Changed(engine.status());
        if client.call::<_, ()>(&changed).await.is_err() {
            return;
        }
    }
}
