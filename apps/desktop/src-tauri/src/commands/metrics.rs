use tauri::State;

use crate::error::Result;
use crate::metrics::{Metrics, MetricsPoint};
use crate::state::AppState;

/// The last sample, so a view can draw before the next `MetricsUpdated` event.
#[tauri::command]
#[specta::specta]
pub(crate) async fn metrics_latest(state: State<'_, AppState>) -> Result<Option<Metrics>> {
    Ok(state.metrics.latest().await)
}

/// The last half hour of samples, oldest first, for the Activity charts.
#[tauri::command]
#[specta::specta]
pub(crate) async fn metrics_history(state: State<'_, AppState>) -> Result<Vec<MetricsPoint>> {
    Ok(state.metrics.history().await)
}
