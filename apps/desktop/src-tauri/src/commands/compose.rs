use std::path::{Path, PathBuf};

use containeria_docker::{ComposeFiles, ComposePreview, ComposeVerb, is_project_name};
use serde::{Deserialize, Serialize};
use tauri::State;
use tauri::ipc::Channel;

use crate::commands::streams::OutputEvent;
use crate::error::{CommandError, ErrorKind, Result};
use crate::state::AppState;

/// Compose files are small; anything bigger is not one.
const MAX_FILE_BYTES: u64 = 1024 * 1024;

/// Where a deploy's definition comes from.
#[derive(Debug, Clone, Deserialize, specta::Type)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub(crate) enum ComposeSource {
    /// A file on the Mac. With `text`, the edits are saved to it first.
    File { path: String, text: Option<String> },
    /// Pasted YAML, kept in Containeria's own folder so later rebuilds find it.
    Text { text: String },
}

/// A project's file, opened for editing.
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ComposeDocument {
    pub(crate) path: String,
    pub(crate) text: String,
}

fn invalid(message: impl Into<String>) -> CommandError {
    CommandError::new(ErrorKind::InvalidInput, message)
}

fn checked_name(name: &str) -> Result<&str> {
    if is_project_name(name) {
        Ok(name)
    } else {
        Err(invalid(
            "Project names use lowercase letters, digits, dashes and underscores, and start with a letter or digit.",
        ))
    }
}

/// The folder pasted projects live in, one per project.
fn pasted_dir(state: &AppState, name: &str) -> PathBuf {
    state.engine.home().root().join("compose").join(name)
}

/// Writes what the source needs on disk and says which files Compose reads.
async fn files_for(state: &AppState, source: &ComposeSource, name: &str) -> Result<ComposeFiles> {
    match source {
        ComposeSource::File { path, text } => {
            let path = PathBuf::from(path);
            if let Some(text) = text {
                tokio::fs::write(&path, text).await.map_err(|error| io_error(&path, &error))?;
            }
            let directory = path.parent().map(Path::to_path_buf);
            Ok(ComposeFiles { files: vec![path], directory })
        }
        ComposeSource::Text { text } => {
            let directory = pasted_dir(state, name);
            tokio::fs::create_dir_all(&directory)
                .await
                .map_err(|error| io_error(&directory, &error))?;
            let path = directory.join("compose.yaml");
            tokio::fs::write(&path, text).await.map_err(|error| io_error(&path, &error))?;
            Ok(ComposeFiles { files: vec![path], directory: Some(directory) })
        }
    }
}

async fn write_scratch(path: &Path, text: &str) -> Result<()> {
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await.map_err(|error| io_error(parent, &error))?;
    }
    tokio::fs::write(path, text).await.map_err(|error| io_error(path, &error))
}

fn io_error(path: &Path, error: &std::io::Error) -> CommandError {
    CommandError::new(ErrorKind::Internal, format!("{}: {error}", path.display()))
}

/// Checks a definition and lists what it will run.
#[tauri::command]
#[specta::specta]
pub(crate) async fn compose_preview(
    state: State<'_, AppState>,
    source: ComposeSource,
    name: Option<String>,
) -> Result<ComposePreview> {
    let compose = state.engine.compose()?;
    let name = name.filter(|name| !name.is_empty());
    if let Some(name) = &name {
        checked_name(name)?;
    }
    // Pasted or edited text is checked from a scratch copy, so nothing is saved before the deploy.
    // Without a `name:`, Compose names a project after its folder, which here is "project".
    let scratch = tempfile::tempdir().map_err(|error| {
        CommandError::new(ErrorKind::Internal, format!("no scratch folder: {error}"))
    })?;
    let scratch_file = scratch.path().join("project").join("compose.yaml");
    let files = match &source {
        ComposeSource::File { path, text: None } => {
            let path = PathBuf::from(path);
            let directory = path.parent().map(Path::to_path_buf);
            ComposeFiles { files: vec![path], directory }
        }
        ComposeSource::File { path, text: Some(text) } => {
            write_scratch(&scratch_file, text).await?;
            let directory = Path::new(path).parent().map(Path::to_path_buf);
            ComposeFiles { files: vec![scratch_file], directory }
        }
        ComposeSource::Text { text } => {
            write_scratch(&scratch_file, text).await?;
            ComposeFiles { files: vec![scratch_file], directory: None }
        }
    };
    compose.preview(&files, name.as_deref()).await.map_err(|error| invalid(error.to_string()))
}

/// Reads a Compose file the user dropped or picked, for the editor.
#[tauri::command]
#[specta::specta]
pub(crate) async fn compose_read(path: String) -> Result<ComposeDocument> {
    let file = PathBuf::from(&path);
    let size = tokio::fs::metadata(&file).await.map_err(|error| io_error(&file, &error))?.len();
    if size > MAX_FILE_BYTES {
        return Err(invalid(format!("{path} is too large to be a Compose file.")));
    }
    let text = tokio::fs::read_to_string(&file).await.map_err(|error| io_error(&file, &error))?;
    Ok(ComposeDocument { path, text })
}

/// The file a running project came from, to edit and deploy again.
#[tauri::command]
#[specta::specta]
pub(crate) async fn compose_project_file(
    state: State<'_, AppState>,
    project: String,
) -> Result<ComposeDocument> {
    let files = state.engine.docker().await?.compose_files(&project).await?;
    let Some(path) = files.and_then(|files| files.files.into_iter().next()) else {
        return Err(CommandError::new(
            ErrorKind::NotFound,
            format!("{project} wasn't started from a Compose file Containeria can find."),
        ));
    };
    compose_read(path.to_string_lossy().into_owned()).await
}

/// Saves the definition, then brings the project up, streaming Compose's output.
#[tauri::command]
#[specta::specta]
pub(crate) async fn compose_deploy(
    state: State<'_, AppState>,
    source: ComposeSource,
    name: String,
    channel: Channel<OutputEvent>,
) -> Result<u32> {
    let name = checked_name(&name)?.to_owned();
    let compose = state.engine.compose()?;
    state.engine.docker().await?;
    let files = files_for(&state, &source, &name).await?;
    Ok(state.streams.spawn(async move {
        let result = compose
            .run(&files, &name, ComposeVerb::Up, |text| {
                let _ = channel.send(OutputEvent::Line { text });
            })
            .await;
        let _ = channel.send(OutputEvent::finished(result));
    }))
}

/// Rebuilds, updates or removes a project Compose started, streaming its output.
#[tauri::command]
#[specta::specta]
pub(crate) async fn compose_act(
    state: State<'_, AppState>,
    project: String,
    verb: ComposeVerb,
    channel: Channel<OutputEvent>,
) -> Result<u32> {
    let compose = state.engine.compose()?;
    let docker = state.engine.docker().await?;
    let files = docker.compose_files(&project).await?.unwrap_or_default();
    let needs_files = matches!(verb, ComposeVerb::Up | ComposeVerb::Rebuild | ComposeVerb::Pull);
    if needs_files && files.files.is_empty() {
        return Err(CommandError::new(
            ErrorKind::NotFound,
            format!("{project} wasn't started from a Compose file Containeria can find."),
        ));
    }
    Ok(state.streams.spawn(async move {
        let mut send = |text| {
            let _ = channel.send(OutputEvent::Line { text });
        };
        let mut result = compose.run(&files, &project, verb, &mut send).await;
        if verb == ComposeVerb::Pull && result.is_ok() {
            result = compose.run(&files, &project, ComposeVerb::Up, &mut send).await;
        }
        let _ = channel.send(OutputEvent::finished(result));
    }))
}
