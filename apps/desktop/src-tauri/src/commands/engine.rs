use contena_engine::EngineConfig;
use tauri::{AppHandle, State};

use crate::engine::EngineStatus;
use crate::error::Result;
use crate::state::AppState;

#[tauri::command]
#[specta::specta]
pub(crate) async fn engine_status(state: State<'_, AppState>) -> Result<EngineStatus> {
    state.engine.status().await
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn engine_start(app: AppHandle, state: State<'_, AppState>) -> Result<()> {
    state.engine.start(&app).await
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn engine_stop(app: AppHandle, state: State<'_, AppState>) -> Result<()> {
    state.engine.stop(&app).await
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn engine_restart(app: AppHandle, state: State<'_, AppState>) -> Result<()> {
    state.engine.stop(&app).await?;
    state.engine.start(&app).await
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn engine_save_config(
    state: State<'_, AppState>,
    config: EngineConfig,
) -> Result<()> {
    state.engine.save_config(&config)
}

/// Deletes the engine's data: every image, container, volume, Linux machine and the Kubernetes
/// cluster. Settings stay.
#[tauri::command]
#[specta::specta]
pub(crate) async fn engine_reset(app: AppHandle, state: State<'_, AppState>) -> Result<()> {
    state.engine.reset(&app).await
}
