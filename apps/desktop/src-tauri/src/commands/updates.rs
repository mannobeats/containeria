use tauri::ipc::Channel;
use tauri::{AppHandle, State};

use crate::error::{CommandError, ErrorKind, Result};
use crate::state::AppState;
use crate::updates::{AppUpdate, UpdateProgress};

fn failed(error: &tauri_plugin_updater::Error) -> CommandError {
    CommandError::new(ErrorKind::Internal, error.to_string())
}

/// Asks the release server whether a newer Contena exists. `None` when this one is the newest.
#[tauri::command]
#[specta::specta]
pub(crate) async fn update_check(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<AppUpdate>> {
    state.updates.look(&app).await.map_err(|error| failed(&error))
}

/// The update the app already knows of, from its own look in the background.
#[tauri::command]
#[specta::specta]
pub(crate) async fn update_found(state: State<'_, AppState>) -> Result<Option<AppUpdate>> {
    Ok(state.updates.found().await)
}

/// Installs the update found and starts Contena again as the new version. The engine stops
/// first, so the new app starts the engine it brings: one from the old version would keep
/// running beside an app that no longer matches it. Returns only when there was nothing to
/// install or it failed.
#[tauri::command]
#[specta::specta]
pub(crate) async fn update_install(
    app: AppHandle,
    state: State<'_, AppState>,
    progress: Channel<UpdateProgress>,
) -> Result<()> {
    let installed = state
        .updates
        .install(|fetched| {
            // The window that asked may be gone; the update goes on without it.
            let _ = progress.send(fetched);
        })
        .await
        .map_err(|error| failed(&error))?;
    if !installed {
        return Ok(());
    }
    // A stopped engine has nothing to stop, and one that won't stop must not keep the update.
    let _ = state.engine.stop(&app).await;
    app.restart()
}
