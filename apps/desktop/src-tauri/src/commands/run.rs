use containeria_docker::RunSpec;
use tauri::State;

use crate::error::Result;
use crate::state::AppState;

/// Pulls the image if needed, then creates and starts the container. Returns its id.
#[tauri::command]
#[specta::specta]
pub(crate) async fn container_run(state: State<'_, AppState>, spec: RunSpec) -> Result<String> {
    Ok(state.engine.docker().await?.run(&spec).await?)
}
