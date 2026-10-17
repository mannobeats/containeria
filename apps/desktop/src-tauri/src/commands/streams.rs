use tauri::State;

use crate::error::Result;
use crate::state::AppState;

/// Stops a stream the UI no longer shows, and closes the terminal it fed, if any.
#[tauri::command]
#[specta::specta]
pub(crate) async fn stream_cancel(state: State<'_, AppState>, id: u32) -> Result<()> {
    state.streams.cancel(id);
    state.shells.close(id);
    Ok(())
}
