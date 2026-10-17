use std::sync::Arc;

use crate::engine::Engine;
use crate::machines::MachinesEngine;
use crate::metrics::Sampler;
use crate::streams::Streams;

#[derive(Debug)]
pub(crate) struct AppState {
    pub(crate) engine: Arc<Engine>,
    pub(crate) machines: MachinesEngine,
    pub(crate) metrics: Arc<Sampler>,
    pub(crate) streams: Streams,
}
