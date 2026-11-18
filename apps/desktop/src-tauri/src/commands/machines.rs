use std::path::{Path, PathBuf};

use containeria_docker::FileEntry;
use containeria_machines::{
    CreateMachine, DISTROS, Distro, Machine, MachineAction, MachineSnapshot,
};
use tauri::ipc::Channel;
use tauri::{AppHandle, State};
use tauri_specta::Event;

use crate::commands::shell::{ShellEvent, attach};
use crate::error::Result;
use crate::events::MachinesChanged;
use crate::machines::{self, container, machines};
use crate::shells::Resizer;
use crate::state::AppState;

#[tauri::command]
#[specta::specta]
pub(crate) async fn machines_list(state: State<'_, AppState>) -> Result<Vec<Machine>> {
    Ok(machines(&state.engine).await?.machines().await?)
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn machine_get(state: State<'_, AppState>, name: String) -> Result<Machine> {
    Ok(machines(&state.engine).await?.machine(&name).await?)
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn machine_distros() -> Result<Vec<Distro>> {
    Ok(DISTROS.to_vec())
}

/// Creates a machine and starts it. `progress` gets sentences for the sheet: the first machine
/// of a release pulls its image and sets it up, which takes about a minute.
#[tauri::command]
#[specta::specta]
pub(crate) async fn machine_create(
    app: AppHandle,
    state: State<'_, AppState>,
    request: CreateMachine,
    progress: Channel<String>,
) -> Result<()> {
    let machines = machines(&state.engine).await?;
    let created =
        machines.create(&request, &machines::user(), |line| drop(progress.send(line))).await;
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
    let result = machines(&state.engine).await?.act(&name, action).await;
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
    let result = machines(&state.engine).await?.delete(&name).await;
    MachinesChanged.emit(&app)?;
    Ok(result?)
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn machine_files(
    state: State<'_, AppState>,
    name: String,
    path: String,
) -> Result<Vec<FileEntry>> {
    Ok(state.engine.docker().await?.list_files(&container(&name)?, &path).await?)
}

/// Copies a file or folder out of the machine to `destination`, a path the user picked on the
/// Mac.
#[tauri::command]
#[specta::specta]
pub(crate) async fn machine_file_download(
    state: State<'_, AppState>,
    name: String,
    path: String,
    destination: String,
) -> Result<()> {
    let docker = state.engine.docker().await?;
    Ok(docker.download(&container(&name)?, &path, Path::new(&destination)).await?)
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
    let docker = state.engine.docker().await?;
    Ok(docker.upload(&container(&name)?, &directory, vec![PathBuf::from(source)]).await?)
}

/// Opens a login shell in the machine as its user. Output streams into `channel`; type with
/// `shell_input`, resize with `shell_resize`.
#[tauri::command]
#[specta::specta]
pub(crate) async fn machine_shell(
    state: State<'_, AppState>,
    name: String,
    cols: u16,
    rows: u16,
    channel: Channel<ShellEvent>,
) -> Result<u32> {
    let machine = machines(&state.engine).await?.machine(&name).await?;
    let docker = state.engine.docker().await?;
    let shell = docker.login_shell(&container(&name)?, &machine.user, cols, rows).await?;
    Ok(attach(&state, shell.output, Resizer::Container(shell.target), shell.input, channel))
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn machine_snapshots(
    state: State<'_, AppState>,
    name: String,
) -> Result<Vec<MachineSnapshot>> {
    Ok(machines(&state.engine).await?.snapshots(&name).await?)
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn machine_snapshot_create(
    state: State<'_, AppState>,
    name: String,
    snapshot: String,
) -> Result<()> {
    Ok(machines(&state.engine).await?.snapshot(&name, &snapshot).await?)
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
    let result = machines(&state.engine).await?.restore(&name, &snapshot).await;
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
    Ok(machines(&state.engine).await?.delete_snapshot(&name, &snapshot).await?)
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
    let result = machines(&state.engine).await?.copy(&name, &to).await;
    MachinesChanged.emit(&app)?;
    Ok(result?)
}

/// Writes the machine's disk to `destination`, a `.tar` path the user picked on the Mac.
#[tauri::command]
#[specta::specta]
pub(crate) async fn machine_export(
    state: State<'_, AppState>,
    name: String,
    destination: String,
) -> Result<()> {
    Ok(machines(&state.engine).await?.export(&name, Path::new(&destination)).await?)
}

/// Creates a stopped machine named `name` from `source`, an archive `machine_export` wrote.
#[tauri::command]
#[specta::specta]
pub(crate) async fn machine_import(
    app: AppHandle,
    state: State<'_, AppState>,
    source: String,
    name: String,
) -> Result<()> {
    let result = machines(&state.engine).await?.import(&name, Path::new(&source)).await;
    MachinesChanged.emit(&app)?;
    Ok(result?)
}

/// The command that opens the machine's login shell from a Mac terminal.
#[tauri::command]
#[specta::specta]
pub(crate) async fn machine_shell_command(
    state: State<'_, AppState>,
    name: String,
) -> Result<String> {
    machines::shell_command(&state.engine, &name).await
}

/// Opens the machine's login shell in a Terminal window.
#[tauri::command]
#[specta::specta]
pub(crate) async fn machine_open_terminal(state: State<'_, AppState>, name: String) -> Result<()> {
    machines::open_terminal(&state.engine, &name).await
}
