use std::sync::Arc;

use containeria_net::Domains;

use crate::engine::Engine;
use crate::kubernetes::Kubernetes;
use crate::machines::MachinesEngine;
use crate::metrics::Sampler;
use crate::preferences::PreferencesStore;
use crate::shells::Shells;
use crate::streams::Streams;

#[derive(Debug)]
pub(crate) struct AppState {
    pub(crate) engine: Arc<Engine>,
    pub(crate) domains: Arc<Domains>,
    pub(crate) kubernetes: Arc<Kubernetes>,
    pub(crate) machines: MachinesEngine,
    pub(crate) metrics: Arc<Sampler>,
    pub(crate) preferences: PreferencesStore,
    pub(crate) streams: Streams,
    pub(crate) shells: Shells,
}
