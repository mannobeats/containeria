use std::sync::Arc;

use crate::engine::Engine;
use crate::metrics::Sampler;
use crate::preferences::PreferencesStore;
use crate::streams::Streams;

#[derive(Debug)]
pub(crate) struct AppState {
    pub(crate) engine: Arc<Engine>,
    pub(crate) metrics: Arc<Sampler>,
    pub(crate) preferences: PreferencesStore,
    pub(crate) streams: Streams,
}
