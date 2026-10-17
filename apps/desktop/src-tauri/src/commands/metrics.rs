use tauri::State;

use crate::error::Result;
use crate::metrics::Metrics;
use crate::state::AppState;

/// The last sample, so a view can draw before the next `MetricsUpdated` event.
#[tauri::command]
#[specta::specta]
pub(crate) async fn metrics_latest(state: State<'_, AppState>) -> Result<Option<Metrics>> {
    Ok(state.metrics.latest().await)
}
