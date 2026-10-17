use std::path::{Path, PathBuf};

use containeria_docker::Docker;
use serde::Serialize;
use tauri::State;
use tauri::ipc::Channel;

use crate::error::{CommandError, ErrorKind, Result};
use crate::state::AppState;

/// What first launch can bring over from Docker Desktop.
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DockerDesktop {
    pub(crate) installed: bool,
    /// Its engine answers, so its images can be copied.
    pub(crate) running: bool,
    pub(crate) images: Vec<String>,
}

#[derive(Debug, Clone, Copy, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ImportState {
    Copying,
    Done,
    Failed,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ImportProgress {
    pub(crate) reference: String,
    pub(crate) state: ImportState,
    pub(crate) message: Option<String>,
}

const APP: &str = "/Applications/Docker.app";

fn socket() -> Option<PathBuf> {
    std::env::home_dir().map(|home| home.join(".docker/run/docker.sock"))
}

async fn connect(socket: &Path) -> Option<Docker> {
    let docker = Docker::connect(socket).ok()?;
    docker.ping().await.ok()?;
    Some(docker)
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn docker_desktop_detect() -> Result<DockerDesktop> {
    let installed = Path::new(APP).exists();
    let docker = match socket() {
        Some(socket) => connect(&socket).await,
        None => None,
    };
    let images = match &docker {
        Some(docker) => docker.image_references().await.unwrap_or_default(),
        None => Vec::new(),
    };
    Ok(DockerDesktop { installed, running: docker.is_some(), images })
}

/// Copies images from Docker Desktop into Containeria's engine, one at a time, reporting each.
/// A failed image is reported and skipped; the rest still copy.
#[tauri::command]
#[specta::specta]
pub(crate) async fn docker_desktop_import_images(
    state: State<'_, AppState>,
    references: Vec<String>,
    progress: Channel<ImportProgress>,
) -> Result<()> {
    let source = match socket() {
        Some(socket) => connect(&socket).await,
        None => None,
    }
    .ok_or_else(|| CommandError::new(ErrorKind::NotFound, "Docker Desktop isn't running."))?;
    let target = state.engine.docker().await?;
    for reference in references {
        let report = |state, message| {
            let _ = progress.send(ImportProgress { reference: reference.clone(), state, message });
        };
        report(ImportState::Copying, None);
        match source.copy_image_to(&target, &reference).await {
            Ok(()) => report(ImportState::Done, None),
            Err(error) => report(ImportState::Failed, Some(error.to_string())),
        }
    }
    Ok(())
}
