use containeria_engine::{EngineConfig, LogLine};
use tauri::ipc::Channel;
use tauri::{AppHandle, State};
use tauri_specta::Event;

use crate::engine::{Engine, EngineStatus};
use crate::error::Result;
use crate::events::EngineChanged;
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

/// Points the Docker CLI's current context back at Containeria, as `docker context use` does.
#[tauri::command]
#[specta::specta]
pub(crate) async fn engine_use_docker_context(app: AppHandle) -> Result<()> {
    Engine::use_docker_context()?;
    EngineChanged.emit(&app)?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn engine_save_config(
    state: State<'_, AppState>,
    config: EngineConfig,
) -> Result<()> {
    state.engine.save_config(&config)
}

/// Deletes the engine's VM, and with `machines` the Linux machines VM too. Settings stay.
#[tauri::command]
#[specta::specta]
pub(crate) async fn engine_reset(
    app: AppHandle,
    state: State<'_, AppState>,
    machines: bool,
) -> Result<()> {
    let engine = state.engine.delete(&app).await;
    let machines = if machines { state.machines.delete(&app).await } else { Ok(()) };
    engine.and(machines)
}
