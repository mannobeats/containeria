use containeria_docker::EngineInfo;
use containeria_engine::Host;
use serde::Serialize;
use tauri::{AppHandle, State};

use crate::error::Result;
use crate::preferences::Preferences;
use crate::state::AppState;
use crate::tray;

#[tauri::command]
#[specta::specta]
pub(crate) async fn preferences_get(state: State<'_, AppState>) -> Result<Preferences> {
    Ok(state.preferences.get())
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn preferences_set(
    app: AppHandle,
    state: State<'_, AppState>,
    preferences: Preferences,
) -> Result<()> {
    state.preferences.set(preferences)?;
    let used = state.metrics.latest().await.map(|metrics| metrics.ledger.used_bytes);
    tray::show_memory(&app, used);
    Ok(())
}

/// The Mac's chip, cores and memory, to size the engine's limits.
#[tauri::command]
#[specta::specta]
pub(crate) async fn host_info() -> Result<Host> {
    Ok(Host::detect().await?)
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct About {
    pub(crate) app_version: String,
    pub(crate) colima_version: Option<String>,
    /// `None` while the engine is stopped.
    pub(crate) engine: Option<EngineInfo>,
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn about(app: AppHandle, state: State<'_, AppState>) -> Result<About> {
    let engine = match state.engine.docker().await {
        Ok(docker) => docker.info().await.ok(),
        Err(_) => None,
    };
    Ok(About {
        app_version: app.package_info().version.to_string(),
        colima_version: state.engine.colima_version().await,
        engine,
    })
}

/// Brings the main window forward, for the menu bar popover.
#[tauri::command]
#[specta::specta]
pub(crate) async fn window_show_main(app: AppHandle) -> Result<()> {
    tray::show_main(&app);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn app_quit(app: AppHandle) -> Result<()> {
    app.exit(0);
    Ok(())
}
