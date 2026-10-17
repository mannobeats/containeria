use futures::stream::BoxStream;
use futures::{SinkExt, StreamExt, future};
use serde_json::{Value, json};
use tokio::net::UnixStream;
use tokio::sync::mpsc;
use tokio_tungstenite::WebSocketStream;
use tokio_tungstenite::tungstenite::Message;

use crate::client::Incus;
use crate::name::validate_name;
use crate::{Error, Result};

/// What the terminal sends to a shell.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ShellInput {
    Data(Vec<u8>),
    Resize { cols: u16, rows: u16 },
}

/// An interactive login shell in a machine, on a pseudo-terminal.
pub struct Shell {
    pub input: mpsc::Sender<ShellInput>,
    /// Terminal output until the shell exits.
    pub output: BoxStream<'static, Vec<u8>>,
}

impl std::fmt::Debug for Shell {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.debug_struct("Shell").field("input", &self.input).finish_non_exhaustive()
    }
}

fn resize_message(cols: u16, rows: u16) -> String {
    json!({ "command": "window-resize", "args": { "width": cols.to_string(), "height": rows.to_string() } })
        .to_string()
}

fn secret(metadata: &Value, fd: &str) -> Result<String> {
    metadata["fds"][fd]
        .as_str()
        .map(str::to_owned)
        .ok_or_else(|| Error::Protocol(format!("exec gave no websocket for {fd}")))
}

fn bytes_of(message: Message) -> Option<Vec<u8>> {
    match message {
        Message::Binary(bytes) => Some(bytes.to_vec()),
        Message::Text(text) => Some(text.as_bytes().to_vec()),
        _ => None,
    }
}

impl Incus {
    async fn websocket(
        &self,
        operation: &str,
        secret: &str,
    ) -> Result<WebSocketStream<UnixStream>> {
        let url = format!("ws://incus{operation}/websocket?secret={secret}");
        let (socket, _) = tokio_tungstenite::client_async(url, self.stream().await?)
            .await
            .map_err(|error| Error::Protocol(error.to_string()))?;
        Ok(socket)
    }

    /// Opens a root login shell (`su -l`) sized `cols` × `rows`.
    ///
    /// # Errors
    /// Fails when the machine isn't running or Incus refuses the exec.
    pub async fn shell(&self, machine: &str, cols: u16, rows: u16) -> Result<Shell> {
        validate_name(machine)?;
        let body = json!({
            "command": ["su", "-l"],
            "environment": { "TERM": "xterm-256color" },
            "interactive": true,
            "wait-for-websocket": true,
            "width": cols,
            "height": rows,
        });
        let path = format!("/1.0/instances/{machine}/exec");
        let (operation, metadata) = self.start_with_metadata(&path, &body).await?;
        let data = self.websocket(&operation, &secret(&metadata, "0")?).await?;
        let control = self.websocket(&operation, &secret(&metadata, "control")?).await?;
        let (mut data_sink, data_stream) = data.split();
        let (mut control_sink, _) = control.split();
        let (input, mut inputs) = mpsc::channel(64);
        tokio::spawn(async move {
            while let Some(next) = inputs.recv().await {
                let sent = match next {
                    ShellInput::Data(bytes) => data_sink.send(Message::Binary(bytes.into())).await,
                    ShellInput::Resize { cols, rows } => {
                        control_sink.send(Message::Text(resize_message(cols, rows).into())).await
                    }
                };
                if sent.is_err() {
                    break;
                }
            }
            let _ = future::join(data_sink.close(), control_sink.close()).await;
        });
        let output = data_stream
            .take_while(|message| {
                future::ready(matches!(message, Ok(message) if !message.is_close()))
            })
            .filter_map(|message| future::ready(message.ok().and_then(bytes_of)))
            .boxed();
        Ok(Shell { input, output })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sends_resizes_in_incus_control_format() {
        let message: Value = serde_json::from_str(&resize_message(120, 40)).unwrap();
        assert_eq!(
            message,
            json!({ "command": "window-resize", "args": { "width": "120", "height": "40" } })
        );
    }

    #[test]
    fn reads_the_websocket_secrets_from_exec_metadata() {
        let metadata = json!({ "fds": { "0": "a1b2", "control": "c3d4" } });
        assert_eq!(secret(&metadata, "0").unwrap(), "a1b2");
        assert_eq!(secret(&metadata, "control").unwrap(), "c3d4");
        assert!(secret(&json!({}), "0").is_err());
    }

    #[test]
    fn passes_terminal_bytes_through() {
        assert_eq!(bytes_of(Message::Binary(vec![27, 91].into())), Some(vec![27, 91]));
        assert_eq!(bytes_of(Message::Text("ok".into())), Some(b"ok".to_vec()));
        assert_eq!(bytes_of(Message::Ping(Vec::new().into())), None);
    }
}
