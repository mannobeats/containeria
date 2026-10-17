use std::pin::pin;

use containeria_docker::{
    BuildSpec, HubImage, ImageDetail, ImageSummary, PruneReport, PullProgress, ScanReport,
};
use futures::StreamExt;
use serde::Serialize;
use tauri::State;
use tauri::ipc::Channel;

use crate::commands::streams::OutputEvent;
use crate::error::{CommandError, ErrorKind, Result};
use crate::state::AppState;

#[tauri::command]
#[specta::specta]
pub(crate) async fn images_list(state: State<'_, AppState>) -> Result<Vec<ImageSummary>> {
    Ok(state.engine.docker().await?.images().await?)
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn image_detail(state: State<'_, AppState>, id: String) -> Result<ImageDetail> {
    Ok(state.engine.docker().await?.image(&id).await?)
}

/// What a pull reports, ending with `done` or `failed`.
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub(crate) enum PullEvent {
    Progress { progress: PullProgress },
    Done,
    Failed { message: String },
}

/// Pulls `reference`, streaming progress into `channel`. Cancel with `stream_cancel`.
#[tauri::command]
#[specta::specta]
pub(crate) async fn image_pull(
    state: State<'_, AppState>,
    reference: String,
    channel: Channel<PullEvent>,
) -> Result<u32> {
    let docker = state.engine.docker().await?;
    Ok(state.streams.spawn(async move {
        let mut steps = pin!(docker.pull(&reference));
        while let Some(step) = steps.next().await {
            let event = match step {
                Ok(progress) => PullEvent::Progress { progress },
                Err(error) => PullEvent::Failed { message: error.to_string() },
            };
            let failed = matches!(event, PullEvent::Failed { .. });
            if channel.send(event).is_err() || failed {
                return;
            }
        }
        let _ = channel.send(PullEvent::Done);
    }))
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn image_remove(
    state: State<'_, AppState>,
    id: String,
    force: bool,
) -> Result<()> {
    Ok(state.engine.docker().await?.remove_image(&id, force).await?)
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn image_tag(
    state: State<'_, AppState>,
    id: String,
    reference: String,
) -> Result<()> {
    Ok(state.engine.docker().await?.tag_image(&id, &reference).await?)
}

/// Deletes images no container uses; with `all` off, only dangling build layers.
#[tauri::command]
#[specta::specta]
pub(crate) async fn images_prune(state: State<'_, AppState>, all: bool) -> Result<PruneReport> {
    Ok(state.engine.docker().await?.prune_images(all).await?)
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn hub_search(state: State<'_, AppState>, term: String) -> Result<Vec<HubImage>> {
    Ok(state.engine.docker().await?.search_hub(&term).await?)
}

/// Builds an image from a folder and Dockerfile, streaming `BuildKit`'s progress.
#[tauri::command]
#[specta::specta]
pub(crate) async fn image_build(
    state: State<'_, AppState>,
    spec: BuildSpec,
    channel: Channel<OutputEvent>,
) -> Result<u32> {
    if spec.tag.trim().is_empty() {
        return Err(CommandError::new(ErrorKind::InvalidInput, "Give the image a name."));
    }
    if !std::path::Path::new(&spec.context).is_dir() {
        return Err(CommandError::new(
            ErrorKind::InvalidInput,
            format!("{} isn't a folder.", spec.context),
        ));
    }
    let cli = state.engine.docker_cli()?;
    state.engine.docker().await?;
    Ok(state.streams.spawn(async move {
        let result = cli
            .build(&spec, |text| {
                let _ = channel.send(OutputEvent::Line { text });
            })
            .await;
        let _ = channel.send(OutputEvent::finished(result));
    }))
}

/// Pushes an image with the logins `docker login` saved, streaming the registry's progress.
#[tauri::command]
#[specta::specta]
pub(crate) async fn image_push(
    state: State<'_, AppState>,
    reference: String,
    channel: Channel<OutputEvent>,
) -> Result<u32> {
    let cli = state.engine.docker_cli()?;
    state.engine.docker().await?;
    Ok(state.streams.spawn(async move {
        let result = cli
            .push(&reference, |text| {
                let _ = channel.send(OutputEvent::Line { text });
            })
            .await;
        let _ = channel.send(OutputEvent::finished(result));
    }))
}

/// Saves an image as a `.tar` archive another engine can load.
#[tauri::command]
#[specta::specta]
pub(crate) async fn image_export(
    state: State<'_, AppState>,
    reference: String,
    path: String,
) -> Result<()> {
    Ok(state.engine.docker().await?.export_image(&reference, std::path::Path::new(&path)).await?)
}

/// Scans an image for known vulnerabilities with Trivy.
#[tauri::command]
#[specta::specta]
pub(crate) async fn image_scan(
    state: State<'_, AppState>,
    reference: String,
) -> Result<ScanReport> {
    Ok(state.engine.docker().await?.scan_image(&reference).await?)
}
