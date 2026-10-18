use containeria_docker::{BuildDetail, BuildRecord};
use tauri::State;
use tauri::ipc::Channel;

use crate::commands::streams::OutputEvent;
use crate::error::Result;
use crate::state::AppState;

#[tauri::command]
#[specta::specta]
pub(crate) async fn builds_list(state: State<'_, AppState>) -> Result<Vec<BuildRecord>> {
    Ok(state.engine.docker_cli()?.builds().await?)
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn build_detail(state: State<'_, AppState>, id: String) -> Result<BuildDetail> {
    Ok(state.engine.docker_cli()?.build_detail(&id).await?)
}

/// Streams a build's output; for a running build it follows live until the build ends. Cancel
/// with `stream_cancel`.
#[tauri::command]
#[specta::specta]
pub(crate) async fn build_logs(
    state: State<'_, AppState>,
    id: String,
    channel: Channel<OutputEvent>,
) -> Result<u32> {
    let cli = state.engine.docker_cli()?;
    Ok(state.streams.spawn(async move {
        let result = cli
            .build_logs(&id, |text| {
                let _ = channel.send(OutputEvent::Line { text });
            })
            .await;
        let _ = channel.send(OutputEvent::finished(result));
    }))
}

/// Removes a build from the history; the image it made stays.
#[tauri::command]
#[specta::specta]
pub(crate) async fn build_remove(state: State<'_, AppState>, id: String) -> Result<()> {
    Ok(state.engine.docker_cli()?.remove_build(&id).await?)
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn builds_clear(state: State<'_, AppState>) -> Result<()> {
    Ok(state.engine.docker_cli()?.clear_builds().await?)
}
