use std::path::PathBuf;

use containeria_docker::{VolumeFile, VolumeSummary};
use tauri::State;

use crate::error::Result;
use crate::state::AppState;
use crate::storage::{CleanUpReport, Prune, clean_up};

#[tauri::command]
#[specta::specta]
pub(crate) async fn volumes_list(state: State<'_, AppState>) -> Result<Vec<VolumeSummary>> {
    Ok(state.engine.docker().await?.volumes().await?)
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn volume_create(state: State<'_, AppState>, name: String) -> Result<()> {
    Ok(state.engine.docker().await?.create_volume(&name).await?)
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn volume_remove(state: State<'_, AppState>, name: String) -> Result<()> {
    Ok(state.engine.docker().await?.remove_volume(&name).await?)
}

/// Deletes every volume no container uses.
#[tauri::command]
#[specta::specta]
pub(crate) async fn volumes_prune(state: State<'_, AppState>) -> Result<CleanUpReport> {
    let docker = state.engine.docker().await?;
    clean_up(&docker, state.engine.own_colima(), Prune::Volumes).await
}

/// One folder of a volume, read through a short-lived helper container.
#[tauri::command]
#[specta::specta]
pub(crate) async fn volume_files(
    state: State<'_, AppState>,
    name: String,
    path: String,
) -> Result<Vec<VolumeFile>> {
    Ok(state.engine.docker().await?.volume_files(&name, &path).await?)
}

/// Copies `path` out of the volume into `destination`, a folder the user picked. Returns where it
/// landed.
#[tauri::command]
#[specta::specta]
pub(crate) async fn volume_download(
    state: State<'_, AppState>,
    name: String,
    path: String,
    destination: PathBuf,
) -> Result<PathBuf> {
    Ok(state.engine.docker().await?.download_from_volume(&name, &path, &destination).await?)
}

/// Saves the whole volume as a `.tar.gz` at `destination`.
#[tauri::command]
#[specta::specta]
pub(crate) async fn volume_backup(
    state: State<'_, AppState>,
    name: String,
    destination: PathBuf,
) -> Result<()> {
    Ok(state.engine.docker().await?.backup_volume(&name, &destination).await?)
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn volume_clone(
    state: State<'_, AppState>,
    source: String,
    target: String,
) -> Result<()> {
    Ok(state.engine.docker().await?.clone_volume(&source, &target).await?)
}

/// Puts a backup's files into `name`, creating it when needed; with `replace`, its current files
/// go first.
#[tauri::command]
#[specta::specta]
pub(crate) async fn volume_restore(
    state: State<'_, AppState>,
    name: String,
    source: PathBuf,
    replace: bool,
) -> Result<()> {
    Ok(state.engine.docker().await?.restore_volume(&name, &source, replace).await?)
}
