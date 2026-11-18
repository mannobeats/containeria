use std::path::PathBuf;

use contena_docker::{DiskUsage, PruneReport};
use contena_engine::{DataLocation, MoveProgress};
use serde::Serialize;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State};

use crate::engine::EnginePhase;
use crate::error::{CommandError, ErrorKind, Result};
use crate::state::AppState;
use crate::storage::MoveGuard;

/// Where the engine's disks live and how much room they take.
#[tauri::command]
#[specta::specta]
pub(crate) async fn storage_location(state: State<'_, AppState>) -> Result<DataLocation> {
    let home = state.engine.home().clone();
    tauri::async_runtime::spawn_blocking(move || contena_engine::location(&home))
        .await
        .map_err(|error| CommandError::new(ErrorKind::Internal, error.to_string()))
}

/// The folder the data would move to inside `folder` (the default with none), or why it can't.
#[tauri::command]
#[specta::specta]
pub(crate) async fn storage_check(
    state: State<'_, AppState>,
    folder: Option<String>,
) -> Result<String> {
    let home = state.engine.home().clone();
    let target = tauri::async_runtime::spawn_blocking(move || {
        contena_engine::destination(&home, folder.map(PathBuf::from).as_deref())
    })
    .await
    .map_err(|error| CommandError::new(ErrorKind::Internal, error.to_string()))??;
    Ok(target.to_string_lossy().into_owned())
}

/// What a move reports, ending with `done` or `failed`.
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub(crate) enum MoveEvent {
    Stopping,
    Copying {
        progress: MoveProgress,
    },
    Starting,
    /// The data moved. `restartError` says what didn't start again, if anything.
    Done {
        location: DataLocation,
        restart_error: Option<String>,
    },
    /// The data stayed where it was.
    Failed {
        message: String,
    },
}

/// Stops the engine, moves its data into `folder` (back to the default with none), and starts
/// it again if it was running.
#[tauri::command]
#[specta::specta]
pub(crate) async fn storage_move(
    app: AppHandle,
    state: State<'_, AppState>,
    folder: Option<String>,
    channel: Channel<MoveEvent>,
) -> Result<u32> {
    if state.engine.is_external() {
        return Err(CommandError::new(
            ErrorKind::InvalidInput,
            "Contena is using another Docker engine, whose data it doesn't manage.",
        ));
    }
    let guard = MoveGuard::take()?;
    let ran = running(state.engine.status().await.ok().map(|status| status.phase))?;
    Ok(state.streams.spawn(async move {
        let (moved, restarted) =
            move_and_restart(&app, folder.map(PathBuf::from), &channel, guard, ran).await;
        let state = app.state::<AppState>();
        let event = match moved {
            Ok(()) => MoveEvent::Done {
                location: contena_engine::location(state.engine.home()),
                restart_error: restarted.err().map(|error| error.message),
            },
            Err(error) => MoveEvent::Failed { message: error.message },
        };
        let _ = channel.send(event);
    }))
}

/// Whether the engine is on now. Refused while it starts or stops, when its disk is in use but
/// stopping it first isn't possible.
fn running(phase: Option<EnginePhase>) -> Result<bool> {
    match phase {
        Some(EnginePhase::Starting | EnginePhase::Stopping) => Err(CommandError::new(
            ErrorKind::InvalidInput,
            "The engine is starting or stopping. Move the data once it has finished.",
        )),
        phase => Ok(matches!(phase, Some(EnginePhase::Running | EnginePhase::Asleep))),
    }
}

/// Whether the move worked, and whether everything that ran before runs again.
async fn move_and_restart(
    app: &AppHandle,
    folder: Option<PathBuf>,
    channel: &Channel<MoveEvent>,
    guard: MoveGuard,
    ran: bool,
) -> (Result<()>, Result<()>) {
    let state = app.state::<AppState>();
    let _ = channel.send(MoveEvent::Stopping);
    let stopped = if ran { state.engine.stop(app).await } else { Ok(()) };
    let moved = match stopped {
        Ok(()) => copy(&state, folder, channel).await,
        Err(error) => Err(error),
    };
    drop(guard);
    let _ = channel.send(MoveEvent::Starting);
    let restarted = if ran { state.engine.start(app).await } else { Ok(()) };
    if let Err(error) = &restarted {
        tracing::error!(%error, "the engine didn't start again after moving its data");
    }
    (moved, restarted)
}

async fn copy(
    state: &AppState,
    folder: Option<PathBuf>,
    channel: &Channel<MoveEvent>,
) -> Result<()> {
    let home = state.engine.home().clone();
    let progress = channel.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut last = 0;
        contena_engine::move_data(&home, folder.as_deref(), |step| {
            // A message per percent is plenty for a progress bar.
            let percent = step.copied_bytes * 100 / step.total_bytes.max(1);
            if percent != last {
                last = percent;
                let _ = progress.send(MoveEvent::Copying { progress: step });
            }
        })
    })
    .await
    .map_err(|error| CommandError::new(ErrorKind::Internal, error.to_string()))?
    .map_err(Into::into)
}

/// Where the engine's disk space goes.
#[tauri::command]
#[specta::specta]
pub(crate) async fn storage_usage(state: State<'_, AppState>) -> Result<DiskUsage> {
    Ok(state.engine.docker().await?.disk_usage().await?)
}

/// Deletes every stopped container.
#[tauri::command]
#[specta::specta]
pub(crate) async fn containers_prune(state: State<'_, AppState>) -> Result<PruneReport> {
    Ok(state.engine.docker().await?.prune_containers().await?)
}

/// Deletes the build cache no build is using.
#[tauri::command]
#[specta::specta]
pub(crate) async fn build_cache_prune(state: State<'_, AppState>) -> Result<PruneReport> {
    Ok(state.engine.docker().await?.prune_build_cache().await?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refuses_to_move_while_a_vm_starts_or_stops() {
        for phase in [EnginePhase::Starting, EnginePhase::Stopping] {
            assert_eq!(running(Some(phase)).unwrap_err().kind, ErrorKind::InvalidInput);
        }
    }

    #[test]
    fn restarts_only_a_vm_that_was_running() {
        assert!(running(Some(EnginePhase::Running)).unwrap());
        assert!(!running(Some(EnginePhase::Stopped)).unwrap());
        assert!(!running(None).unwrap());
    }
}
