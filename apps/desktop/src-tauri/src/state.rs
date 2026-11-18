use std::sync::Arc;

use crate::data::DataState;
use crate::engine::Engine;
use crate::kubernetes::Kubernetes;
use crate::metrics::Sampler;
use crate::preferences::PreferencesStore;
use crate::shells::Shells;
use crate::streams::Streams;
use crate::updates::Updates;
use contena_net::Domains;

#[derive(Debug)]
pub(crate) struct AppState {
    pub(crate) engine: Arc<Engine>,
    pub(crate) domains: Arc<Domains>,
    pub(crate) kubernetes: Arc<Kubernetes>,
    pub(crate) metrics: Arc<Sampler>,
    pub(crate) preferences: PreferencesStore,
    pub(crate) streams: Streams,
    pub(crate) data: Arc<DataState>,
    pub(crate) shells: Shells,
    pub(crate) updates: Arc<Updates>,
}
