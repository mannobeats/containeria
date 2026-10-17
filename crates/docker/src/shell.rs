use std::fmt;
use std::pin::Pin;

use bollard::container::LogOutput;
use bollard::exec::{CreateExecOptions, StartExecOptions, StartExecResults};
use bollard::models::{ContainerCreateBody, HostConfig};
use bollard::query_parameters::{
    AttachContainerOptionsBuilder, CreateContainerOptionsBuilder, RemoveContainerOptionsBuilder,
    ResizeContainerTTYOptionsBuilder, ResizeExecOptionsBuilder, StartContainerOptions,
};
use bytes::Bytes;
use futures::stream::BoxStream;
use futures::{StreamExt, TryStreamExt};
use tokio::io::AsyncWrite;

use crate::{Docker, Error, Result};

/// The image the debug shell runs beside a container that has no shell of its own.
const DEBUG_IMAGE: &str = "busybox:1.38";

/// Prefer bash, fall back to sh, the way `docker exec -it` users usually do by hand.
const SHELL: [&str; 3] =
    ["/bin/sh", "-c", "command -v bash >/dev/null 2>&1 && exec bash || exec sh"];

/// What to resize when the terminal changes size.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ShellTarget {
    Exec(String),
    Container(String),
}

/// An interactive TTY: raw output bytes in, keystrokes out.
pub struct Shell {
    pub target: ShellTarget,
    pub output: BoxStream<'static, Result<Bytes>>,
    pub input: Pin<Box<dyn AsyncWrite + Send>>,
}

impl fmt::Debug for Shell {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.debug_struct("Shell").field("target", &self.target).finish_non_exhaustive()
    }
}

fn bytes(output: LogOutput) -> Bytes {
    match output {
        LogOutput::StdErr { message }
        | LogOutput::StdOut { message }
        | LogOutput::StdIn { message }
        | LogOutput::Console { message } => message,
    }
}

fn output(
    stream: Pin<
        Box<
            dyn futures::Stream<Item = std::result::Result<LogOutput, bollard::errors::Error>>
                + Send,
        >,
    >,
) -> BoxStream<'static, Result<Bytes>> {
    stream.map_ok(bytes).map_err(Error::from).boxed()
}

impl Docker {
    /// A login shell inside a running container, sized `cols` × `rows`.
    ///
    /// # Errors
    /// Fails when the container isn't running. A container without `/bin/sh` fails when the
    /// shell starts; the debug shell is the way in then.
    pub async fn shell(&self, id: &str, cols: u16, rows: u16) -> Result<Shell> {
        let exec = self
            .api
            .create_exec(
                id,
                CreateExecOptions {
                    attach_stdin: Some(true),
                    attach_stdout: Some(true),
                    attach_stderr: Some(true),
                    tty: Some(true),
                    env: Some(vec!["TERM=xterm-256color"]),
                    cmd: Some(SHELL.to_vec()),
                    ..CreateExecOptions::default()
                },
            )
            .await?;
        let start = StartExecOptions { detach: false, tty: true, output_capacity: None };
        let StartExecResults::Attached { output: stream, input } =
            self.api.start_exec(&exec.id, Some(start)).await?
        else {
            return Err(Error::Engine("the shell started detached".to_owned()));
        };
        let target = ShellTarget::Exec(exec.id);
        self.resize_shell(&target, cols, rows).await?;
        Ok(Shell { target, output: output(stream), input })
    }

    /// A busybox shell that shares the container's processes and network, for images without a
    /// shell. The container's own files are under `/proc/1/root`. The sidecar removes itself when
    /// the shell ends.
    ///
    /// # Errors
    /// Fails when the container isn't running or busybox can't be pulled.
    pub async fn debug_shell(&self, id: &str, cols: u16, rows: u16) -> Result<Shell> {
        self.ensure_image(DEBUG_IMAGE).await?;
        let name = format!("containeria-debug-{}", id.get(..12).unwrap_or(id));
        let replace = RemoveContainerOptionsBuilder::new().force(true).build();
        // A sidecar left over from a crash would block the name; it's ours to remove.
        let _ = self.api.remove_container(&name, Some(replace)).await;
        let joined = format!("container:{id}");
        let body = ContainerCreateBody {
            image: Some(DEBUG_IMAGE.to_owned()),
            cmd: Some(vec!["sh".to_owned()]),
            env: Some(vec!["TERM=xterm-256color".to_owned()]),
            tty: Some(true),
            open_stdin: Some(true),
            stdin_once: Some(true),
            attach_stdin: Some(true),
            attach_stdout: Some(true),
            attach_stderr: Some(true),
            host_config: Some(HostConfig {
                pid_mode: Some(joined.clone()),
                network_mode: Some(joined),
                cap_add: Some(vec!["SYS_PTRACE".to_owned()]),
                auto_remove: Some(true),
                ..HostConfig::default()
            }),
            ..ContainerCreateBody::default()
        };
        let options = CreateContainerOptionsBuilder::new().name(&name).build();
        let created = self.api.create_container(Some(options), body).await?;
        let attach = AttachContainerOptionsBuilder::new()
            .stream(true)
            .stdin(true)
            .stdout(true)
            .stderr(true)
            .build();
        let attached = self.api.attach_container(&created.id, Some(attach)).await?;
        self.api.start_container(&created.id, None::<StartContainerOptions>).await?;
        let target = ShellTarget::Container(created.id);
        self.resize_shell(&target, cols, rows).await?;
        Ok(Shell { target, output: output(attached.output), input: attached.input })
    }

    /// # Errors
    /// Fails when the shell has already ended.
    pub async fn resize_shell(&self, target: &ShellTarget, cols: u16, rows: u16) -> Result<()> {
        match target {
            ShellTarget::Exec(id) => {
                let size =
                    ResizeExecOptionsBuilder::new().h(i32::from(rows)).w(i32::from(cols)).build();
                self.api.resize_exec(id, size).await?;
            }
            ShellTarget::Container(id) => {
                let size = ResizeContainerTTYOptionsBuilder::new()
                    .h(i32::from(rows))
                    .w(i32::from(cols))
                    .build();
                self.api.resize_container_tty(id, size).await?;
            }
        }
        Ok(())
    }
}

/// Turns a byte stream into text without splitting a multi-byte character across two chunks.
#[derive(Debug, Default)]
pub struct Utf8Decoder {
    pending: Vec<u8>,
}

impl Utf8Decoder {
    /// Everything complete so far; an unfinished character waits for the next chunk.
    pub fn push(&mut self, chunk: &[u8]) -> String {
        self.pending.extend_from_slice(chunk);
        let complete = match std::str::from_utf8(&self.pending) {
            Err(error) if error.error_len().is_none() => error.valid_up_to(),
            _ => self.pending.len(),
        };
        let rest = self.pending.split_off(complete);
        let text = String::from_utf8_lossy(&self.pending).into_owned();
        self.pending = rest;
        text
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn holds_back_a_character_split_across_chunks() {
        let mut decoder = Utf8Decoder::default();
        let euro = "€".as_bytes();
        assert_eq!(decoder.push(&[b'a', euro[0], euro[1]]), "a");
        assert_eq!(decoder.push(&[euro[2], b'b']), "€b");
    }

    #[test]
    fn replaces_invalid_bytes_instead_of_waiting_forever() {
        let mut decoder = Utf8Decoder::default();
        assert_eq!(decoder.push(&[0xff, b'x']), "\u{fffd}x");
        assert_eq!(decoder.push(b""), "");
    }
}
