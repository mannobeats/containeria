//! Docker's daemon: starting it, knowing when it answers, keeping it running, stopping it.

use std::fs;
use std::time::Duration;

use containeria_agent::daemon::{GROUP, SOCKET, settings};
use rustix::process::{Pid, Signal, kill_process};
use serde_json::Value;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixStream;
use tokio::process::{Child, Command};
use tokio::sync::watch;
use tokio::task::JoinHandle;

use crate::error::{Doing, Error, Result};
use crate::log;

const SETTINGS: &str = "/etc/docker/daemon.json";
/// Docker stops its containers before it exits, each with ten seconds to finish by default.
const STOP_PATIENCE: Duration = Duration::from_secs(30);

pub(crate) struct Docker {
    stop: watch::Sender<bool>,
    stopped: JoinHandle<()>,
}

impl Docker {
    /// Starts Docker and returns once it answers on its socket.
    pub(crate) async fn start(custom: &Value) -> Result<Self> {
        fs::create_dir_all("/etc/docker").doing("create /etc/docker")?;
        fs::write(SETTINGS, settings(custom).to_string()).doing("write Docker's settings")?;
        let mut daemon = spawn()?;
        tokio::select! {
            () = answering() => {}
            status = daemon.wait() => {
                let status = status.doing("wait for Docker")?;
                return Err(Error::Failed(format!("Docker stopped as it started ({status}).")));
            }
        }
        let (stop, stopping) = watch::channel(false);
        Ok(Self { stop, stopped: tokio::spawn(keep_running(daemon, stopping)) })
    }

    /// Stops Docker and with it every container.
    pub(crate) async fn stop(self) {
        let _ = self.stop.send(true);
        let _ = self.stopped.await;
    }
}

/// Docker runs in a control group of its own: it reads its limits there, and a group that has
/// them is what tells it swap can be limited. The shell joins the group before it becomes Docker,
/// so everything Docker starts is in it from its first moment.
fn spawn() -> Result<Child> {
    let group = format!("/sys/fs/cgroup/{GROUP}");
    fs::create_dir_all(&group).doing("create Docker's control group")?;
    let become_docker =
        format!("echo $$ > {group}/cgroup.procs && exec dockerd --config-file {SETTINGS}");
    Command::new("sh").args(["-c", &become_docker]).spawn().doing("start Docker")
}

async fn answering() {
    while !ping().await {
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
}

async fn ping() -> bool {
    api("GET", "/_ping").await.is_ok()
}

/// One call on Docker's API, for the agent's own few needs. Returns the answer's body when
/// Docker said the call worked.
pub(crate) async fn api(method: &str, path: &str) -> std::io::Result<Vec<u8>> {
    let mut socket = UnixStream::connect(SOCKET).await?;
    // HTTP/1.0, so Docker closes the connection after its answer and sends the body whole.
    socket.write_all(format!("{method} {path} HTTP/1.0\r\n\r\n").as_bytes()).await?;
    let mut answer = Vec::new();
    socket.read_to_end(&mut answer).await?;
    let worked = answer.get(9..10) == Some(b"2".as_slice());
    let body = answer.windows(4).position(|window| window == b"\r\n\r\n").map(|at| at + 4);
    match body {
        Some(body) if worked => Ok(answer.split_off(body)),
        _ => Err(std::io::Error::other("Docker refused the call")),
    }
}

/// Docker's events that pass `filters`, one to a line, for as long as Docker runs.
pub(crate) async fn events(filters: &str) -> std::io::Result<BufReader<UnixStream>> {
    let mut socket = UnixStream::connect(SOCKET).await?;
    // HTTP/1.0 again: the events follow the headers as they are, with no framing between them.
    socket.write_all(format!("GET /events?filters={filters} HTTP/1.0\r\n\r\n").as_bytes()).await?;
    let mut events = BufReader::new(socket);
    let mut header = String::new();
    events.read_line(&mut header).await?;
    if header.get(9..10) != Some("2") {
        return Err(std::io::Error::other("Docker refused to tell of its events"));
    }
    while header != "\r\n" {
        header.clear();
        if events.read_line(&mut header).await? == 0 {
            return Err(std::io::ErrorKind::UnexpectedEof.into());
        }
    }
    Ok(events)
}

/// Starts Docker again whenever it ends on its own, until asked to stop.
async fn keep_running(mut daemon: Child, mut stopping: watch::Receiver<bool>) {
    loop {
        tokio::select! {
            status = daemon.wait() => {
                log(format_args!("Docker ended on its own ({status:?}); starting it again"));
                tokio::time::sleep(Duration::from_secs(1)).await;
                match spawn() {
                    Ok(started) => daemon = started,
                    Err(error) => {
                        log(error);
                        return;
                    }
                }
            }
            _ = stopping.changed() => return terminate(daemon).await,
        }
    }
}

async fn terminate(mut daemon: Child) {
    let pid = daemon.id().and_then(|id| i32::try_from(id).ok()).and_then(Pid::from_raw);
    if let Some(pid) = pid {
        let _ = kill_process(pid, Signal::TERM);
    }
    if tokio::time::timeout(STOP_PATIENCE, daemon.wait()).await.is_err() {
        log("Docker didn't stop in 30 seconds; ending it");
        let _ = daemon.kill().await;
    }
}
