use std::path::PathBuf;

use containeria_docker::DiskUsage;
use containeria_engine::{DataLocation, MoveProgress, Profile};
use serde::Serialize;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State};

use crate::engine::EnginePhase;
use crate::error::{CommandError, ErrorKind, Result};
use crate::state::AppState;
use crate::storage::{CleanUpReport, MoveGuard, Prune, clean_up};

/// Where the engine's disks live and how much room they take.
#[tauri::command]
#[specta::specta]
pub(crate) async fn storage_location(state: State<'_, AppState>) -> Result<DataLocation> {
    let home = state.engine.home().clone();
    tauri::async_runtime::spawn_blocking(move || containeria_engine::location(&home))
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
        containeria_engine::destination(&home, folder.map(PathBuf::from).as_deref())
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

/// Stops the VMs, moves their disks into `folder` (back to the default with none), and starts
/// again whatever was running.
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
            "Containeria is using another Docker engine, whose data it doesn't manage.",
        ));
    }
    let guard = MoveGuard::take()?;
    let engine_ran = running(state.engine.status().await.ok().map(|status| status.phase))?;
    let machines_ran = running(state.machines.status().await.ok().map(|status| status.phase))?;
    Ok(state.streams.spawn(async move {
        let ran = (engine_ran, machines_ran);
        let (moved, restarted) =
            move_and_restart(&app, folder.map(PathBuf::from), &channel, guard, ran).await;
        let state = app.state::<AppState>();
        let event = match moved {
            Ok(()) => MoveEvent::Done {
                location: containeria_engine::location(state.engine.home()),
                restart_error: restarted.err().map(|error| error.message),
            },
            Err(error) => MoveEvent::Failed { message: error.message },
        };
        let _ = channel.send(event);
    }))
}

/// Whether a VM runs now. Refused while it starts or stops, when its disks are in use but stopping
/// it first isn't possible.
fn running(phase: Option<EnginePhase>) -> Result<bool> {
    match phase {
        Some(EnginePhase::Starting | EnginePhase::Stopping) => Err(CommandError::new(
            ErrorKind::InvalidInput,
            "A VM is starting or stopping. Move the data once it has finished.",
        )),
        phase => Ok(phase == Some(EnginePhase::Running)),
    }
}

/// Whether the move worked, and whether everything that ran before runs again.
async fn move_and_restart(
    app: &AppHandle,
    folder: Option<PathBuf>,
    channel: &Channel<MoveEvent>,
    guard: MoveGuard,
    (engine_ran, machines_ran): (bool, bool),
) -> (Result<()>, Result<()>) {
    let state = app.state::<AppState>();
    let _ = channel.send(MoveEvent::Stopping);
    let moved = match stop(app, engine_ran, machines_ran).await {
        Ok(()) => copy(&state, folder, channel).await,
        Err(error) => Err(error),
    };
    drop(guard);
    let _ = channel.send(MoveEvent::Starting);
    let restarted = start(app, engine_ran, machines_ran).await;
    if let Err(error) = &restarted {
        tracing::error!(%error, "a VM didn't start again after moving its data");
    }
    (moved, restarted)
}

async fn stop(app: &AppHandle, engine: bool, machines: bool) -> Result<()> {
    let state = app.state::<AppState>();
    if machines {
        state.machines.stop(app, |_| {}).await?;
    }
    if engine {
        state.engine.stop(app, |_| {}).await?;
    }
    Ok(())
}

/// Starts both VMs that ran before, the second even when the first fails.
async fn start(app: &AppHandle, engine: bool, machines: bool) -> Result<()> {
    let state = app.state::<AppState>();
    let engine = if engine { state.engine.start(app, |_| {}).await } else { Ok(()) };
    let machines = if machines {
        match state.engine.config() {
            Ok(config) => state.machines.start(app, &config, |_| {}).await,
            Err(error) => Err(error),
        }
    } else {
        Ok(())
    };
    engine.and(machines)
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
        containeria_engine::move_data(&home, folder.as_deref(), |step| {
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

/// The containers VM's disk files on the Mac.
#[derive(Debug, Clone, Copy, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EngineDisk {
    /// Allocated size, so space Docker freed but the guest hasn't trimmed yet still counts.
    #[specta(type = specta_typescript::Number)]
    pub(crate) size_bytes: u64,
}

/// What the containers VM's disk really takes on the Mac, or `None` on another Docker engine.
#[tauri::command]
#[specta::specta]
pub(crate) async fn storage_engine_disk(state: State<'_, AppState>) -> Result<Option<EngineDisk>> {
    if state.engine.own_colima().is_none() {
        return Ok(None);
    }
    let size_bytes = containeria_engine::disk_size(state.engine.home(), Profile::Containers);
    Ok(Some(EngineDisk { size_bytes }))
}

/// How much the VM disk files shrank on the Mac.
#[derive(Debug, Clone, Copy, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReturnedSpace {
    #[specta(type = specta_typescript::Number)]
    pub(crate) returned_bytes: u64,
}

/// Trims every running VM, without cleaning anything up, so space already freed inside goes back
/// to the Mac.
#[tauri::command]
#[specta::specta]
pub(crate) async fn storage_return_free_space(state: State<'_, AppState>) -> Result<ReturnedSpace> {
    let colima = state.engine.own_colima().ok_or_else(|| {
        CommandError::new(
            ErrorKind::InvalidInput,
            "Containeria is using another Docker engine, whose disk it doesn't manage.",
        )
    })?;
    Ok(ReturnedSpace { returned_bytes: colima.return_free_space().await? })
}

/// Deletes every stopped container.
#[tauri::command]
#[specta::specta]
pub(crate) async fn containers_prune(state: State<'_, AppState>) -> Result<CleanUpReport> {
    let docker = state.engine.docker().await?;
    clean_up(&docker, state.engine.own_colima(), Prune::Containers).await
}

/// Deletes the build cache no build is using.
#[tauri::command]
#[specta::specta]
pub(crate) async fn build_cache_prune(state: State<'_, AppState>) -> Result<CleanUpReport> {
    let docker = state.engine.docker().await?;
    clean_up(&docker, state.engine.own_colima(), Prune::BuildCache).await
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
