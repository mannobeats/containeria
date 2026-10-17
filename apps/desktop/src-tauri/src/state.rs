use std::sync::Arc;

use crate::engine::Engine;
use crate::kubernetes::Kubernetes;
use crate::metrics::Sampler;
use crate::streams::Streams;

#[derive(Debug)]
pub(crate) struct AppState {
    pub(crate) engine: Arc<Engine>,
    pub(crate) kubernetes: Arc<Kubernetes>,
    pub(crate) metrics: Arc<Sampler>,
    pub(crate) streams: Streams,
}
