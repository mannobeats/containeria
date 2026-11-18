//! Docker's socket on the Mac. Every connection is carried to Docker in the guest, waking the VM
//! first when it sleeps, so `docker` and everything else that speaks to Docker never notice the
//! difference. Two more sockets lead into a guest that already runs: one to Docker for programs
//! that only watch, one to any address in the guest's network.

use std::io;
use std::pin::Pin;
use std::sync::Arc;
use std::task::{Context, Poll};

use containeria_proto::{DOCKER_PORT, FORWARD_PORT};
use tokio::io::{AsyncRead, AsyncWrite, AsyncWriteExt, ReadBuf, copy_bidirectional};
use tokio::net::{UnixListener, UnixStream};

use super::{Activity, Engine};

/// Who a socket is for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Use {
    /// `docker` and anything else that wants something done: wakes the VM and keeps it awake.
    Work,
    /// Watchers: served while the VM runs, refused while it sleeps, and never a reason to stay up.
    Watch,
    /// A connection to an address in the guest, which its first line names. As for watchers, the
    /// VM is neither woken nor kept awake for it.
    Inside,
}

pub(crate) async fn serve(listener: UnixListener, engine: Arc<Engine>, used_for: Use) {
    while let Ok((client, _)) = listener.accept().await {
        let engine = Arc::clone(&engine);
        tokio::spawn(async move {
            let _ = match used_for {
                Use::Work => work(client, &engine).await,
                Use::Watch => watch(client, &engine).await,
                Use::Inside => inside(client, &engine).await,
            };
        });
    }
}

async fn work(mut client: UnixStream, engine: &Arc<Engine>) -> io::Result<()> {
    engine.activity.touch();
    let guest = match engine.wake().await {
        Ok(guest) => guest,
        Err(error) => {
            let reason = format!("Containeria's engine couldn't start. {error}");
            return refuse(&mut client, &reason).await;
        }
    };
    let mut docker = match guest.vmm.connect(DOCKER_PORT).await {
        Ok(docker) => docker,
        Err(error) => {
            tracing::warn!("a connection to Docker couldn't reach the guest: {error}");
            return refuse(&mut client, "Docker in Containeria's engine couldn't be reached.")
                .await;
        }
    };
    let mut client = Watched { stream: client, activity: &engine.activity, asked: false };
    // Either side hanging up ends the connection; there is nothing to report.
    let _ = copy_bidirectional(&mut client, &mut docker).await;
    Ok(())
}

async fn watch(mut client: UnixStream, engine: &Engine) -> io::Result<()> {
    let Some(guest) = engine.running() else {
        return refuse(&mut client, "Containeria's engine is asleep.").await;
    };
    let mut docker = guest.vmm.connect(DOCKER_PORT).await.map_err(io::Error::other)?;
    copy_bidirectional(&mut client, &mut docker).await?;
    Ok(())
}

/// The guest reads the line that says where the connection goes, so this only joins the two.
async fn inside(mut client: UnixStream, engine: &Engine) -> io::Result<()> {
    let Some(guest) = engine.running() else { return Ok(()) };
    let mut carried = guest.vmm.connect(FORWARD_PORT).await.map_err(io::Error::other)?;
    copy_bidirectional(&mut client, &mut carried).await?;
    Ok(())
}

/// Answers as Docker would, so the `docker` command prints why the engine couldn't start.
async fn refuse(client: &mut UnixStream, reason: &str) -> io::Result<()> {
    let body =
        serde_json::json!({ "message": format!("Containeria's engine couldn't start. {reason}") })
            .to_string();
    let answer = format!(
        "HTTP/1.1 503 Service Unavailable\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    client.write_all(answer.as_bytes()).await?;
    client.shutdown().await
}

/// A client's connection that tells the engine when it is in use: while a request waits for its
/// answer, and whenever bytes move. A stream of events that stays open but silent doesn't keep
/// the VM awake; a pull or a build does.
struct Watched<'a> {
    stream: UnixStream,
    activity: &'a Activity,
    /// The client sent something Docker hasn't started answering.
    asked: bool,
}

impl Drop for Watched<'_> {
    fn drop(&mut self) {
        if self.asked {
            self.activity.answered();
        }
    }
}

impl AsyncRead for Watched<'_> {
    fn poll_read(
        mut self: Pin<&mut Self>,
        context: &mut Context<'_>,
        buffer: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        let before = buffer.filled().len();
        let read = Pin::new(&mut self.stream).poll_read(context, buffer);
        if read.is_ready() && buffer.filled().len() > before {
            self.activity.touch();
            if !self.asked {
                self.asked = true;
                self.activity.asked();
            }
        }
        read
    }
}

impl AsyncWrite for Watched<'_> {
    fn poll_write(
        mut self: Pin<&mut Self>,
        context: &mut Context<'_>,
        bytes: &[u8],
    ) -> Poll<io::Result<usize>> {
        let written = Pin::new(&mut self.stream).poll_write(context, bytes);
        if written.is_ready() {
            if self.asked {
                self.asked = false;
                self.activity.answered();
            } else {
                self.activity.touch();
            }
        }
        written
    }

    fn poll_flush(mut self: Pin<&mut Self>, context: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.stream).poll_flush(context)
    }

    fn poll_shutdown(mut self: Pin<&mut Self>, context: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.stream).poll_shutdown(context)
    }
}
