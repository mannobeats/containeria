use containeria_docker::{HubImage, RunSpec};
use tauri::State;

use crate::error::Result;
use crate::state::AppState;

/// Pulls the image if needed, then creates and starts the container. Returns its id.
#[tauri::command]
#[specta::specta]
pub(crate) async fn container_run(state: State<'_, AppState>, spec: RunSpec) -> Result<String> {
    Ok(state.engine.docker().await?.run(&spec).await?)
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn hub_search(state: State<'_, AppState>, term: String) -> Result<Vec<HubImage>> {
    Ok(state.engine.docker().await?.search_hub(&term).await?)
}
