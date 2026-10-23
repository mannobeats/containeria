use std::fmt;
use std::pin::Pin;

use futures::channel::mpsc;
use futures::stream::BoxStream;
use futures::{SinkExt, StreamExt, stream};
use k8s_openapi::api::core::v1::Pod;
use kube::api::{AttachParams, TerminalSize};
use tokio::io::{AsyncReadExt, AsyncWrite};

use crate::{Error, Kube, Result};

/// Prefer bash, fall back to sh, the way `kubectl exec -it` users usually do by hand. The API has no
/// way to set the environment of an exec, so the shell sets `TERM` for itself.
const SHELL: [&str; 3] = [
    "/bin/sh",
    "-c",
    "export TERM=xterm-256color; command -v bash >/dev/null 2>&1 && exec bash || exec sh",
];

/// kube buffers 1 KiB of output by default, which stalls a `cat` of anything larger on every chunk.
const OUTPUT_BUFFER: usize = 64 * 1024;

fn attach_params(container: Option<String>) -> AttachParams {
    AttachParams { container, ..AttachParams::interactive_tty().max_stdout_buf_size(OUTPUT_BUFFER) }
}

/// Changes the size of a pod terminal.
#[derive(Debug, Clone)]
pub struct PodResize(mpsc::Sender<TerminalSize>);

impl PodResize {
    /// # Errors
    /// Fails when the shell has already ended.
    pub async fn resize(&mut self, cols: u16, rows: u16) -> Result<()> {
        self.0
            .send(TerminalSize { width: cols, height: rows })
            .await
            .map_err(|_| Error::Api("The terminal has closed.".to_owned()))
    }
}

/// An interactive TTY in a pod: raw output bytes in, keystrokes out. Dropping `output` ends it.
pub struct PodShell {
    pub output: BoxStream<'static, std::io::Result<Vec<u8>>>,
    pub input: Pin<Box<dyn AsyncWrite + Send>>,
    pub resize: PodResize,
}

impl fmt::Debug for PodShell {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.debug_struct("PodShell").finish_non_exhaustive()
    }
}

impl Kube {
    /// A shell in one of the pod's containers (the first when `container` is `None`), sized
    /// `cols` × `rows`, as `kubectl exec -it` opens.
    ///
    /// # Errors
    /// Fails when the pod is gone or not running. A container without `/bin/sh` fails when the
    /// shell starts: its output ends at once.
    pub async fn shell(
        &self,
        namespace: &str,
        pod: &str,
        container: Option<String>,
        cols: u16,
        rows: u16,
    ) -> Result<PodShell> {
        let mut process =
            self.namespaced::<Pod>(namespace).exec(pod, SHELL, &attach_params(container)).await?;
        let closed = || Error::Api("The shell closed before it started.".to_owned());
        let input = process.stdin().ok_or_else(closed)?;
        let stdout = process.stdout().ok_or_else(closed)?;
        let mut resize = PodResize(process.terminal_size().ok_or_else(closed)?);
        resize.resize(cols, rows).await?;
        // The stream owns the process: dropping it aborts the exec, which closes the shell.
        let output = stream::unfold((process, stdout), |(process, mut stdout)| async move {
            let mut chunk = vec![0; 8192];
            match stdout.read(&mut chunk).await {
                Ok(0) => None,
                Ok(read) => {
                    chunk.truncate(read);
                    Some((Ok(chunk), (process, stdout)))
                }
                Err(error) => Some((Err(error), (process, stdout))),
            }
        });
        Ok(PodShell { output: output.boxed(), input: Box::pin(input), resize })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn asks_for_an_interactive_tty_in_the_chosen_container() {
        let params = attach_params(Some("sidecar".to_owned()));
        assert_eq!(params.container.as_deref(), Some("sidecar"));
        assert!(params.stdin && params.stdout && params.tty);
        assert!(!params.stderr, "a TTY merges stderr into stdout; asking for both is refused");
        assert_eq!(params.max_stdout_buf_size, Some(OUTPUT_BUFFER));
    }

    #[test]
    fn leaves_the_container_to_the_api_when_none_is_chosen() {
        assert_eq!(attach_params(None).container, None);
    }
}
