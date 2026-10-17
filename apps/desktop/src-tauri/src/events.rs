use containeria_docker::DockerEvent;

use crate::metrics::Metrics;
use serde::{Deserialize, Serialize};

/// The engine started, stopped or changed settings; refetch its status.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, tauri_specta::Event)]
pub(crate) struct EngineChanged;

/// Something in Docker changed; refetch lists of that kind.
#[derive(Debug, Clone, Serialize, specta::Type, tauri_specta::Event)]
pub(crate) struct DockerChanged(pub(crate) DockerEvent);

/// A fresh CPU and memory sample, about every two seconds while the engine runs.
#[derive(Debug, Clone, Serialize, specta::Type, tauri_specta::Event)]
pub(crate) struct MetricsUpdated(pub(crate) Metrics);
