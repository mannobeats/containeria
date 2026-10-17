use std::pin::Pin;

use containeria_docker::Utf8Decoder;
use futures::StreamExt;
use futures::stream::BoxStream;
use serde::Serialize;
use tauri::State;
use tauri::ipc::Channel;
use tokio::io::AsyncWrite;

use crate::error::{CommandError, ErrorKind, Result};
use crate::shells::Resizer;
use crate::state::AppState;

/// What a terminal receives: text to draw, then one `closed` when the shell exits.
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub(crate) enum ShellEvent {
    Output { text: String },
    Closed,
}

/// Opens a terminal in the container, or a busybox debug shell beside it when `debug` is set.
/// Output streams into `channel`; type with `shell_input`, resize with `shell_resize`.
#[tauri::command]
#[specta::specta]
pub(crate) async fn container_shell(
    state: State<'_, AppState>,
    id: String,
    debug: bool,
    cols: u16,
    rows: u16,
    channel: Channel<ShellEvent>,
) -> Result<u32> {
    let docker = state.engine.docker().await?;
    let shell = if debug {
        docker.debug_shell(&id, cols, rows).await?
    } else {
        docker.shell(&id, cols, rows).await?
    };
    Ok(attach(&state, shell.output, Resizer::Container(shell.target), shell.input, channel))
}

/// Opens a root shell in the engine's Linux VM, as `colima ssh` does.
#[tauri::command]
#[specta::specta]
pub(crate) async fn engine_shell(
    state: State<'_, AppState>,
    cols: u16,
    rows: u16,
    channel: Channel<ShellEvent>,
) -> Result<u32> {
    let shell = state.engine.docker().await?.engine_shell(cols, rows).await?;
    Ok(attach(&state, shell.output, Resizer::Container(shell.target), shell.input, channel))
}

/// Pumps a shell's output into `channel` as text and registers its input for `shell_input` and
/// `shell_resize`. Returns the stream id; `stream_cancel` closes the shell.
pub(crate) fn attach<B, E>(
    state: &AppState,
    mut output: BoxStream<'static, std::result::Result<B, E>>,
    resizer: Resizer,
    input: Pin<Box<dyn AsyncWrite + Send>>,
    channel: Channel<ShellEvent>,
) -> u32
where
    B: AsRef<[u8]> + Send + 'static,
    E: Send + 'static,
{
    let shells = state.shells.clone();
    // The pump learns its own id before it starts, so it can't close a shell not yet registered.
    let (known, id_known) = tokio::sync::oneshot::channel::<u32>();
    let stream = state.streams.spawn(async move {
        let Ok(stream) = id_known.await else { return };
        let mut decoder = Utf8Decoder::default();
        while let Some(Ok(chunk)) = output.next().await {
            let text = decoder.push(chunk.as_ref());
            if !text.is_empty() && channel.send(ShellEvent::Output { text }).is_err() {
                break;
            }
        }
        let _ = channel.send(ShellEvent::Closed);
        shells.close(stream);
    });
    state.shells.open(stream, resizer, input);
    let _ = known.send(stream);
    stream
}

/// Types into an open terminal.
#[tauri::command]
#[specta::specta]
pub(crate) async fn shell_input(
    state: State<'_, AppState>,
    stream: u32,
    text: String,
) -> Result<()> {
    match state.shells.write(stream, &text).await {
        Ok(true) => Ok(()),
        Ok(false) => Err(closed()),
        Err(error) => Err(CommandError::new(ErrorKind::Engine, error.to_string())),
    }
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn shell_resize(
    state: State<'_, AppState>,
    stream: u32,
    cols: u16,
    rows: u16,
) -> Result<()> {
    match state.shells.resizer(stream).ok_or_else(closed)? {
        Resizer::Container(target) => {
            Ok(state.engine.docker().await?.resize_shell(&target, cols, rows).await?)
        }
        Resizer::Pod(mut resize) => Ok(resize.resize(cols, rows).await?),
    }
}

fn closed() -> CommandError {
    CommandError::new(ErrorKind::NotFound, "The terminal has closed.")
}
