use serde::Serialize;
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

/// What a command-line tool reports while it runs (Compose, a build, a push), ending with `done`
/// or `failed`.
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub(crate) enum OutputEvent {
    Line { text: String },
    Done,
    Failed { message: String },
}

impl OutputEvent {
    pub(crate) fn finished(result: Result<(), impl std::fmt::Display>) -> Self {
        match result {
            Ok(()) => Self::Done,
            Err(error) => Self::Failed { message: error.to_string() },
        }
    }
}
