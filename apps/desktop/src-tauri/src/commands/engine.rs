use containeria_engine::{EngineConfig, LogLine};
use tauri::ipc::Channel;
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
pub(crate) async fn engine_start(
    app: AppHandle,
    state: State<'_, AppState>,
    progress: Channel<LogLine>,
) -> Result<()> {
    state.engine.start(&app, |line| drop(progress.send(line))).await
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn engine_stop(
    app: AppHandle,
    state: State<'_, AppState>,
    progress: Channel<LogLine>,
) -> Result<()> {
    state.engine.stop(&app, |line| drop(progress.send(line))).await
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn engine_restart(
    app: AppHandle,
    state: State<'_, AppState>,
    progress: Channel<LogLine>,
) -> Result<()> {
    state.engine.stop(&app, |line| drop(progress.send(line.clone()))).await?;
    state.engine.start(&app, |line| drop(progress.send(line))).await
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn engine_save_config(
    state: State<'_, AppState>,
    config: EngineConfig,
) -> Result<()> {
    state.engine.save_config(&config)
}
