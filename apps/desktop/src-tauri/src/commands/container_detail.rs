use std::path::PathBuf;
use std::pin::pin;

use containeria_docker::{ContainerDetails, FileEntry, LogEntry};
use futures::StreamExt;
use tauri::State;
use tauri::ipc::Channel;

use crate::error::{CommandError, ErrorKind, Result};
use crate::state::AppState;

#[tauri::command]
#[specta::specta]
pub(crate) async fn container_details(
    state: State<'_, AppState>,
    id: String,
) -> Result<ContainerDetails> {
    Ok(state.engine.docker().await?.details(&id).await?)
}

/// Streams the last `tail` lines, then new ones as they're written, until cancelled.
#[tauri::command]
#[specta::specta]
pub(crate) async fn container_logs(
    state: State<'_, AppState>,
    id: String,
    tail: u32,
    channel: Channel<Vec<LogEntry>>,
) -> Result<u32> {
    let docker = state.engine.docker().await?;
    Ok(state.streams.spawn(async move {
        let mut batches = pin!(docker.logs(&id, tail));
        while let Some(Ok(batch)) = batches.next().await {
            if !batch.is_empty() && channel.send(batch).is_err() {
                break;
            }
        }
    }))
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn container_files(
    state: State<'_, AppState>,
    id: String,
    path: String,
) -> Result<Vec<FileEntry>> {
    Ok(state.engine.docker().await?.list_files(&id, &path).await?)
}

/// Saves `path` from the container to `destination` on the Mac.
#[tauri::command]
#[specta::specta]
pub(crate) async fn container_download(
    state: State<'_, AppState>,
    id: String,
    path: String,
    destination: PathBuf,
) -> Result<()> {
    Ok(state.engine.docker().await?.download(&id, &path, &destination).await?)
}

/// Copies files and folders from the Mac into `directory`.
#[tauri::command]
#[specta::specta]
pub(crate) async fn container_upload(
    state: State<'_, AppState>,
    id: String,
    directory: String,
    sources: Vec<PathBuf>,
) -> Result<()> {
    Ok(state.engine.docker().await?.upload(&id, &directory, sources).await?)
}

/// Writes the whole filesystem to `destination` as a tar.
#[tauri::command]
#[specta::specta]
pub(crate) async fn container_export(
    state: State<'_, AppState>,
    id: String,
    destination: PathBuf,
) -> Result<()> {
    Ok(state.engine.docker().await?.export(&id, &destination).await?)
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn container_rename(
    state: State<'_, AppState>,
    id: String,
    name: String,
) -> Result<()> {
    Ok(state.engine.docker().await?.rename(&id, &name).await?)
}

/// Saves the container as image `reference` and returns the new image id.
#[tauri::command]
#[specta::specta]
pub(crate) async fn container_commit(
    state: State<'_, AppState>,
    id: String,
    reference: String,
) -> Result<String> {
    Ok(state.engine.docker().await?.commit(&id, &reference).await?)
}

/// Writes text the user chose to save, such as logs, to the path they picked in a save dialog.
#[tauri::command]
#[specta::specta]
pub(crate) async fn save_text(destination: PathBuf, contents: String) -> Result<()> {
    tokio::fs::write(&destination, contents)
        .await
        .map_err(|error| CommandError::new(ErrorKind::Internal, error.to_string()))
}

/// Creates the container again from its own settings; with `pull`, from a newer image.
#[tauri::command]
#[specta::specta]
pub(crate) async fn container_recreate(
    state: State<'_, AppState>,
    id: String,
    pull: bool,
) -> Result<String> {
    Ok(state.engine.docker().await?.recreate(&id, pull).await?)
}
