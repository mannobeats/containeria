use std::sync::Arc;

use containeria_net::Domains;

use crate::engine::Engine;
use crate::metrics::Sampler;
use crate::streams::Streams;

#[derive(Debug)]
pub(crate) struct AppState {
    pub(crate) engine: Arc<Engine>,
    pub(crate) domains: Arc<Domains>,
    pub(crate) metrics: Arc<Sampler>,
    pub(crate) streams: Streams,
}
