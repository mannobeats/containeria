//! What the app and `cx` ask of the engine over its socket, and what it tells them.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum Phase {
    /// Off: no engine process, no Docker socket.
    Stopped,
    Starting,
    Running,
    /// On, with the VM off because nothing runs in it. The next use of Docker wakes it.
    Asleep,
    Stopping,
    /// The VM didn't start or stopped by itself; [`Status::problem`] says why. Starting again
    /// retries.
    Failed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub phase: Phase,
    pub problem: Option<String>,
    /// The VM, while it runs.
    pub vm: Option<Vm>,
    pub kubernetes: ClusterState,
}

impl Status {
    #[must_use]
    pub const fn stopped() -> Self {
        Self { phase: Phase::Stopped, problem: None, vm: None, kubernetes: ClusterState::Off }
    }
}

/// The Kubernetes cluster inside the engine.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", tag = "state", content = "problem")]
pub enum ClusterState {
    Off,
    /// k3s is starting; the first time, it is fetched and pulls its own images first.
    Starting,
    Running,
    /// It didn't start, and why. Turning Kubernetes on again retries.
    Failed(String),
}

/// The VM as it was started. Settings saved since apply at its next start.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Vm {
    pub cpus: u16,
    pub memory: MemoryUse,
    /// The guest's Linux release.
    pub kernel: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct MemoryUse {
    /// The most the VM may ever use, from the settings.
    #[specta(type = specta_typescript::Number)]
    pub ceiling_bytes: u64,
    /// What the VM may use right now: what its work holds plus room to grow.
    #[specta(type = specta_typescript::Number)]
    pub allowed_bytes: u64,
    /// What containers and the system inside hold, without file cache.
    #[specta(type = specta_typescript::Number)]
    pub used_bytes: u64,
}

/// A call from the app or `cx`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ClientCall {
    /// Answer: [`Status`].
    Status,
    /// Wakes the VM if it sleeps and waits for Docker. Answer: `()`.
    Start,
    /// Stops the VM and ends the engine. Answer: `()`, once the VM is off.
    Stop,
    /// Starts the cluster with the saved settings, and selects it in the kubeconfig. Answer: `()`,
    /// once its API answers.
    KubernetesStart,
    /// Stops the cluster and takes it out of the kubeconfig. Its objects are kept. Answer: `()`.
    KubernetesStop,
    /// Deletes everything in the cluster and starts a fresh one. Answer: `()`.
    KubernetesReset,
    /// Wakes the VM and keeps it awake for as long as this connection stays open. Answer: `()`,
    /// at once; the phase says when the VM is up.
    Hold,
    /// From now on the engine calls back with [`EngineNote::Changed`]. Answer: `()`.
    Subscribe,
}

/// A call from the engine to a client that subscribed. Answered with `()`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum EngineNote {
    Changed(Status),
}
