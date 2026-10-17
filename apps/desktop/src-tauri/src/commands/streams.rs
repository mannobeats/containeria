use tauri::State;

use crate::error::Result;
use crate::state::AppState;

/// Stops a stream the UI no longer shows.
#[tauri::command]
#[specta::specta]
pub(crate) async fn stream_cancel(state: State<'_, AppState>, id: u32) -> Result<()> {
    state.streams.cancel(id);
    Ok(())
}
