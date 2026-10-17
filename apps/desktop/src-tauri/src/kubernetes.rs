use std::pin::pin;
use std::sync::{Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use containeria_kube::Kube;
use futures::StreamExt;
use serde::Serialize;
use tauri::AppHandle;
use tauri_specta::Event;
use tokio::sync::RwLock;

use crate::engine::Engine;
use crate::error::{CommandError, ErrorKind, Result};
use crate::events::KubeChanged;

/// A running `localhost` → pod tunnel. `stream` stops it with `kubernetes_stop_forward`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PortForward {
    pub(crate) stream: u32,
    pub(crate) namespace: String,
    pub(crate) pod: String,
    pub(crate) local_port: u16,
    pub(crate) pod_port: u16,
}

/// The k3s cluster in the engine, connected while Kubernetes is on, and the port forwards into it.
#[derive(Debug, Default)]
pub(crate) struct Kubernetes {
    client: RwLock<Option<Kube>>,
    forwards: Mutex<Vec<PortForward>>,
}

impl Kubernetes {
    pub(crate) fn forwards(&self) -> Vec<PortForward> {
        self.forwards_lock().clone()
    }

    pub(crate) fn add_forward(&self, forward: PortForward) {
        self.forwards_lock().push(forward);
    }

    /// Forgets the forward; the caller cancels its stream.
    pub(crate) fn remove_forward(&self, stream: u32) {
        self.forwards_lock().retain(|forward| forward.stream != stream);
    }

    fn forwards_lock(&self) -> MutexGuard<'_, Vec<PortForward>> {
        self.forwards.lock().unwrap_or_else(PoisonError::into_inner)
    }

    const RECONNECT_EVERY: Duration = Duration::from_secs(3);
    /// Changes arrive in bursts (a rollout touches many pods); one refetch per burst is enough.
    const QUIET_FOR: Duration = Duration::from_millis(300);

    /// `$CONTAINERIA_KUBE_CONTEXT` points the app at another cluster, as `CONTAINERIA_DOCKER_SOCKET`
    /// does for Docker.
    fn context() -> String {
        std::env::var("CONTAINERIA_KUBE_CONTEXT")
            .unwrap_or_else(|_| containeria_kube::CONTEXT.to_owned())
    }

    /// A connected client, connecting on first use.
    ///
    /// # Errors
    /// Fails with `KubernetesUnavailable` while the cluster is off or starting.
    pub(crate) async fn client(&self, engine: &Engine) -> Result<Kube> {
        if !Self::enabled(engine) {
            return Err(CommandError::new(ErrorKind::KubernetesUnavailable, "Kubernetes is off."));
        }
        if let Some(client) = self.client.read().await.as_ref() {
            return Ok(client.clone());
        }
        let client = Kube::connect(&Self::context()).await?;
        *self.client.write().await = Some(client.clone());
        Ok(client)
    }

    pub(crate) async fn forget(&self) {
        *self.client.write().await = None;
    }

    fn enabled(engine: &Engine) -> bool {
        std::env::var_os("CONTAINERIA_KUBE_CONTEXT").is_some()
            || engine.config().is_ok_and(|config| config.kubernetes.enabled)
    }

    /// Runs for the life of the app: while Kubernetes is on, tells the UI when the cluster changes.
    pub(crate) async fn watch(&self, engine: &Engine, app: AppHandle) {
        loop {
            if let Ok(client) = self.client(engine).await {
                let _ = KubeChanged.emit(&app);
                let mut changes = pin!(client.changes());
                while let Some(Ok(())) = changes.next().await {
                    while let Ok(Some(_)) =
                        tokio::time::timeout(Self::QUIET_FOR, changes.next()).await
                    {
                    }
                    let _ = KubeChanged.emit(&app);
                }
                self.forget().await;
                let _ = KubeChanged.emit(&app);
            }
            tokio::time::sleep(Self::RECONNECT_EVERY).await;
        }
    }
}
