use std::sync::Arc;

use crate::data::DataState;
use crate::engine::Engine;
use crate::metrics::Sampler;
use crate::streams::Streams;

#[derive(Debug)]
pub(crate) struct AppState {
    pub(crate) engine: Arc<Engine>,
    pub(crate) metrics: Arc<Sampler>,
    pub(crate) streams: Streams,
    pub(crate) data: Arc<DataState>,
}
