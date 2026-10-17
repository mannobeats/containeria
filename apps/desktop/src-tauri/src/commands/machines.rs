use containeria_engine::LogLine;
use std::path::Path;

use containeria_machines::{
    CreateMachine, DISTROS, Distro, Machine, MachineAction, MachineFile, MachineSnapshot,
    ShellInput,
};
use tauri::ipc::Channel;
use tauri::{AppHandle, State};
use tauri_specta::Event;

use crate::engine::EnginePhase;
use crate::error::{CommandError, ErrorKind, Result};
use crate::events::MachinesChanged;
use crate::machines::MachinesStatus;
use crate::state::AppState;

#[tauri::command]
#[specta::specta]
pub(crate) async fn machines_status(state: State<'_, AppState>) -> Result<MachinesStatus> {
    state.machines.status().await
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn machines_start(
    app: AppHandle,
    state: State<'_, AppState>,
    progress: Channel<LogLine>,
) -> Result<()> {
    let settings = state.engine.config()?;
    state.machines.start(&app, &settings, |line| drop(progress.send(line))).await
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn machines_stop(
    app: AppHandle,
    state: State<'_, AppState>,
    progress: Channel<LogLine>,
) -> Result<()> {
    state.machines.stop(&app, |line| drop(progress.send(line))).await
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn machines_list(state: State<'_, AppState>) -> Result<Vec<Machine>> {
    Ok(state.machines.incus().await?.machines().await?)
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn machine_get(state: State<'_, AppState>, name: String) -> Result<Machine> {
    Ok(state.machines.incus().await?.machine(&name).await?)
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn machine_distros() -> Result<Vec<Distro>> {
    Ok(DISTROS.to_vec())
}

/// Creates a machine, first setting up and starting the machines VM if this is the first one.
/// `progress` gets sentences for the sheet: the VM booting, then the image download.
#[tauri::command]
#[specta::specta]
pub(crate) async fn machine_create(
    app: AppHandle,
    state: State<'_, AppState>,
    request: CreateMachine,
    progress: Channel<String>,
) -> Result<()> {
    let status = state.machines.status().await?;
    if status.phase != EnginePhase::Running {
        let settings = state.engine.config()?;
        state.machines.start(&app, &settings, |line| drop(progress.send(line.message))).await?;
    }
    let home = std::env::home_dir();
    let incus = state.machines.incus().await?;
    let created =
        incus.create(&request, home.as_deref(), |message| drop(progress.send(message))).await;
    MachinesChanged.emit(&app)?;
    Ok(created?)
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn machine_act(
    app: AppHandle,
    state: State<'_, AppState>,
    name: String,
    action: MachineAction,
) -> Result<()> {
    let result = state.machines.incus().await?.act(&name, action).await;
    MachinesChanged.emit(&app)?;
    Ok(result?)
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn machine_delete(
    app: AppHandle,
    state: State<'_, AppState>,
    name: String,
) -> Result<()> {
    let result = state.machines.incus().await?.delete(&name).await;
    MachinesChanged.emit(&app)?;
    Ok(result?)
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn machine_files(
    state: State<'_, AppState>,
    name: String,
    path: String,
) -> Result<Vec<MachineFile>> {
    Ok(state.machines.incus().await?.list_files(&name, &path).await?)
}

/// Copies a file out of the machine to `destination`, a path the user picked on the Mac.
#[tauri::command]
#[specta::specta]
pub(crate) async fn machine_file_download(
    state: State<'_, AppState>,
    name: String,
    path: String,
    destination: String,
) -> Result<()> {
    let contents = state.machines.incus().await?.read_file(&name, &path).await?;
    tokio::fs::write(&destination, contents).await.map_err(|error| {
        CommandError::new(
            ErrorKind::Internal,
            format!("{destination} couldn't be written: {error}"),
        )
    })
}

/// Copies `source`, a file the user picked on the Mac, into `directory` in the machine.
#[tauri::command]
#[specta::specta]
pub(crate) async fn machine_file_upload(
    state: State<'_, AppState>,
    name: String,
    source: String,
    directory: String,
) -> Result<()> {
    let file_name = Path::new(&source)
        .file_name()
        .map(|file| file.to_string_lossy().into_owned())
        .ok_or_else(|| CommandError::new(ErrorKind::Internal, format!("{source} isn't a file.")))?;
    // ponytail: reads the whole file into memory; stream it if people upload multi-GB files.
    let contents = tokio::fs::read(&source).await.map_err(|error| {
        CommandError::new(ErrorKind::Internal, format!("{source} couldn't be read: {error}"))
    })?;
    let target = format!("{}/{file_name}", directory.trim_end_matches('/'));
    Ok(state.machines.incus().await?.write_file(&name, &target, contents.into()).await?)
}

/// Opens a root login shell and streams its output into `output` until it exits or is cancelled
/// with `stream_cancel`. Returns the id `machine_shell_input` and `machine_shell_resize` take.
#[tauri::command]
#[specta::specta]
pub(crate) async fn machine_shell(
    state: State<'_, AppState>,
    name: String,
    cols: u16,
    rows: u16,
    output: Channel<String>,
) -> Result<u32> {
    let shell = state.machines.incus().await?.shell(&name, cols, rows).await?;
    Ok(state.machines.attach(&state.streams, shell, move |text| drop(output.send(text))))
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn machine_shell_input(
    state: State<'_, AppState>,
    id: u32,
    data: String,
) -> Result<()> {
    state.machines.send(id, ShellInput::Data(data.into_bytes())).await;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn machine_shell_resize(
    state: State<'_, AppState>,
    id: u32,
    cols: u16,
    rows: u16,
) -> Result<()> {
    state.machines.send(id, ShellInput::Resize { cols, rows }).await;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn machine_snapshots(
    state: State<'_, AppState>,
    name: String,
) -> Result<Vec<MachineSnapshot>> {
    Ok(state.machines.incus().await?.snapshots(&name).await?)
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn machine_snapshot_create(
    state: State<'_, AppState>,
    name: String,
    snapshot: String,
) -> Result<()> {
    Ok(state.machines.incus().await?.snapshot(&name, &snapshot).await?)
}

/// Puts the machine back as it was in `snapshot`; everything since is lost.
#[tauri::command]
#[specta::specta]
pub(crate) async fn machine_snapshot_restore(
    app: AppHandle,
    state: State<'_, AppState>,
    name: String,
    snapshot: String,
) -> Result<()> {
    let result = state.machines.incus().await?.restore(&name, &snapshot).await;
    MachinesChanged.emit(&app)?;
    Ok(result?)
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn machine_snapshot_delete(
    state: State<'_, AppState>,
    name: String,
    snapshot: String,
) -> Result<()> {
    Ok(state.machines.incus().await?.delete_snapshot(&name, &snapshot).await?)
}

/// Copies the machine to a new, stopped machine named `to`.
#[tauri::command]
#[specta::specta]
pub(crate) async fn machine_clone(
    app: AppHandle,
    state: State<'_, AppState>,
    name: String,
    to: String,
) -> Result<()> {
    let result = state.machines.incus().await?.copy(&name, &to).await;
    MachinesChanged.emit(&app)?;
    Ok(result?)
}

/// Writes the machine to `destination`, a `.tar.gz` path the user picked on the Mac.
#[tauri::command]
#[specta::specta]
pub(crate) async fn machine_export(
    state: State<'_, AppState>,
    name: String,
    destination: String,
) -> Result<()> {
    Ok(state.machines.incus().await?.export(&name, Path::new(&destination)).await?)
}

/// Creates a stopped machine named `name` from `source`, a `.tar.gz` that `machine_export` wrote.
#[tauri::command]
#[specta::specta]
pub(crate) async fn machine_import(
    app: AppHandle,
    state: State<'_, AppState>,
    source: String,
    name: String,
) -> Result<()> {
    let result = state.machines.incus().await?.import(&name, Path::new(&source)).await;
    MachinesChanged.emit(&app)?;
    Ok(result?)
}

/// The command that opens the machine's root shell from a Mac terminal.
#[tauri::command]
#[specta::specta]
pub(crate) async fn machine_shell_command(
    state: State<'_, AppState>,
    name: String,
) -> Result<String> {
    state.machines.shell_command(&name).await
}

/// Opens the machine's root shell in a Terminal window.
#[tauri::command]
#[specta::specta]
pub(crate) async fn machine_open_terminal(state: State<'_, AppState>, name: String) -> Result<()> {
    state.machines.open_terminal(&name).await
}
