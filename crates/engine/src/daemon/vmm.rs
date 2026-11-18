//! The helper that runs the VM (`vmm/` in this repository) and the engine's end of talking to it.
//!
//! The helper's standard input is one end of a socket pair. Lines of JSON go both ways, and the
//! answer to `connect` brings the new connection's descriptor with it. The helper stops the VM
//! when its end closes, so dropping a [`Vmm`] turns the VM off.
//!
//! Connections the guest opens arrive the other way, as `accepted` events carrying a descriptor
//! each; [`Vmm::accepted`] hands them out. The helper also watches the Mac's folders for the
//! engine, since it is the part that speaks to Apple's frameworks: [`Vmm::watch`] names them and
//! [`Vmm::changes`] hands out what it reports.
//!
//! The helper holds Apple's object for every connection until the engine releases it, which a
//! [`Connection`] does when it is dropped. Letting that object go while the descriptor is still
//! in use cuts about one new connection in a hundred off before its first answer.

use std::collections::{HashMap, VecDeque};
use std::io::{self, IoSliceMut};
use std::mem::MaybeUninit;
use std::os::fd::OwnedFd;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, PoisonError};

use rustix::net::{RecvAncillaryBuffer, RecvAncillaryMessage, RecvFlags, recvmsg};
use serde::{Deserialize, Serialize};
use std::pin::Pin;
use std::task::{Context, Poll};

use tokio::io::{AsyncRead, AsyncWrite, Interest, ReadBuf};
use tokio::net::UnixStream;
use tokio::process::Command;
use tokio::sync::{mpsc, oneshot, watch};
use tokio::task::JoinHandle;

use crate::error::{Error, Result};

/// The VM the helper is asked to run.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Machine {
    pub(crate) cpus: u16,
    pub(crate) memory_bytes: u64,
    pub(crate) kernel: PathBuf,
    pub(crate) command_line: String,
    pub(crate) disks: Vec<Disk>,
    pub(crate) shares: Vec<Share>,
    pub(crate) rosetta_tag: Option<String>,
    pub(crate) console: PathBuf,
    pub(crate) mac_address: String,
    /// The port the guest connects to for what it wants on the Mac.
    pub(crate) host_port: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Disk {
    pub(crate) path: PathBuf,
    pub(crate) read_only: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Share {
    pub(crate) tag: String,
    pub(crate) path: PathBuf,
    pub(crate) read_only: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Power {
    Starting,
    On,
    /// Off, with the reason when the VM didn't stop on purpose.
    Off(Option<String>),
}

#[derive(Serialize)]
#[serde(tag = "op", rename_all = "camelCase")]
enum Request {
    Connect { id: u64, port: u32 },
    Release { id: u64 },
    Balloon { bytes: u64 },
    Watch { paths: Vec<PathBuf> },
    Stop,
}

#[derive(Deserialize)]
struct Message {
    id: Option<u64>,
    event: Option<String>,
    error: Option<String>,
    changes: Option<Vec<FileEvent>>,
}

/// Something happened to a file or folder on the Mac. `flags` are the ones macOS reports file
/// events with: they say what kinds of things happened to it lately, not what state it is in now.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub(crate) struct FileEvent {
    pub(crate) path: PathBuf,
    pub(crate) flags: u32,
}

type Waiting = HashMap<u64, oneshot::Sender<Result<OwnedFd>>>;

#[derive(Debug)]
struct Link {
    socket: UnixStream,
    writing: tokio::sync::Mutex<()>,
    /// `None` once the helper is gone, so a late `connect` fails instead of waiting forever.
    waiting: Mutex<Option<Waiting>>,
    next: AtomicU64,
}

/// A connection to the guest, opened by either side. Dropping it closes it and has the helper
/// let it go.
#[derive(Debug)]
pub(crate) struct Connection {
    stream: UnixStream,
    id: u64,
    released: mpsc::UnboundedSender<u64>,
}

impl Connection {
    fn new(descriptor: OwnedFd, id: u64, released: mpsc::UnboundedSender<u64>) -> io::Result<Self> {
        let stream = std::os::unix::net::UnixStream::from(descriptor);
        stream.set_nonblocking(true)?;
        Ok(Self { stream: UnixStream::from_std(stream)?, id, released })
    }
}

impl Drop for Connection {
    fn drop(&mut self) {
        // Fails only once the helper is gone, and its connections with it.
        let _ = self.released.send(self.id);
    }
}

impl AsyncRead for Connection {
    fn poll_read(
        mut self: Pin<&mut Self>,
        context: &mut Context<'_>,
        buffer: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        Pin::new(&mut self.stream).poll_read(context, buffer)
    }
}

impl AsyncWrite for Connection {
    fn poll_write(
        mut self: Pin<&mut Self>,
        context: &mut Context<'_>,
        bytes: &[u8],
    ) -> Poll<io::Result<usize>> {
        Pin::new(&mut self.stream).poll_write(context, bytes)
    }

    fn poll_flush(mut self: Pin<&mut Self>, context: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.stream).poll_flush(context)
    }

    fn poll_shutdown(mut self: Pin<&mut Self>, context: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.stream).poll_shutdown(context)
    }
}

#[derive(Debug)]
pub(crate) struct Vmm {
    link: Arc<Link>,
    power: watch::Receiver<Power>,
    released: mpsc::UnboundedSender<u64>,
    accepted: Mutex<Option<mpsc::UnboundedReceiver<Connection>>>,
    changes: Mutex<Option<mpsc::UnboundedReceiver<Vec<FileEvent>>>>,
    tasks: [JoinHandle<()>; 3],
}

impl Drop for Vmm {
    fn drop(&mut self) {
        for task in &self.tasks {
            task.abort();
        }
    }
}

impl Vmm {
    /// Starts the helper with `machine`, written as `vm.json` in `folder`.
    pub(crate) fn start(helper: &Path, machine: &Machine, folder: &Path) -> Result<Self> {
        let settings = folder.join("vm.json");
        std::fs::write(&settings, serde_json::to_vec(machine)?)?;
        let (ours, theirs) = std::os::unix::net::UnixStream::pair()?;
        ours.set_nonblocking(true)?;
        let mut child = Command::new(helper)
            .arg(&settings)
            .stdin(Stdio::from(OwnedFd::from(theirs)))
            .stdout(Stdio::null())
            .kill_on_drop(true)
            .spawn()
            .map_err(|error| Error::Engine(format!("The VM helper didn't start: {error}")))?;
        let link = Arc::new(Link {
            socket: UnixStream::from_std(ours)?,
            writing: tokio::sync::Mutex::new(()),
            waiting: Mutex::new(Some(Waiting::new())),
            next: AtomicU64::new(1),
        });
        let (set_power, power) = watch::channel(Power::Starting);
        let (released, mut dropped) = mpsc::unbounded_channel();
        let (accept, accepted) = mpsc::unbounded_channel();
        let (changed, file_events) = mpsc::unbounded_channel();
        let events =
            Events { power: set_power.clone(), accept, released: released.clone(), changed };
        let reading = tokio::spawn(read(Arc::clone(&link), events));
        let exiting = tokio::spawn(async move {
            let status = child.wait().await;
            // The helper says why it stops before it exits; this only speaks when it couldn't.
            set_power.send_if_modified(|power| {
                let already_off = matches!(power, Power::Off(_));
                if !already_off {
                    *power =
                        Power::Off(Some(format!("The VM helper ended unexpectedly ({status:?}).")));
                }
                !already_off
            });
        });
        let releasing = tokio::spawn({
            let link = Arc::clone(&link);
            async move {
                while let Some(id) = dropped.recv().await {
                    if link.send(&Request::Release { id }).await.is_err() {
                        return;
                    }
                }
            }
        });
        let accepted = Mutex::new(Some(accepted));
        let tasks = [reading, exiting, releasing];
        Ok(Self { link, power, released, accepted, changes: Mutex::new(Some(file_events)), tasks })
    }

    /// What the Mac reports about the watched folders, a batch at a time, oldest first. There is
    /// one receiver: `None` once taken.
    pub(crate) fn changes(&self) -> Option<mpsc::UnboundedReceiver<Vec<FileEvent>>> {
        self.changes.lock().unwrap_or_else(PoisonError::into_inner).take()
    }

    /// Watches these folders of the Mac, and no others, for changes.
    pub(crate) async fn watch(&self, paths: Vec<PathBuf>) -> Result<()> {
        self.link.send(&Request::Watch { paths }).await
    }

    /// The connections the guest opens, as they arrive. There is one receiver: `None` once taken.
    pub(crate) fn accepted(&self) -> Option<mpsc::UnboundedReceiver<Connection>> {
        self.accepted.lock().unwrap_or_else(PoisonError::into_inner).take()
    }

    /// Waits until the VM runs.
    pub(crate) async fn on(&self) -> Result<()> {
        let mut power = self.power.clone();
        let reached = power.wait_for(|power| *power != Power::Starting).await;
        match reached.as_deref() {
            Ok(Power::On) => Ok(()),
            Ok(Power::Off(Some(reason))) => Err(Error::Engine(reason.clone())),
            _ => Err(Error::Stopped),
        }
    }

    /// Waits until the VM is off and says why, when it wasn't on purpose.
    pub(crate) async fn off(&self) -> Option<String> {
        let mut power = self.power.clone();
        match power.wait_for(|power| matches!(power, Power::Off(_))).await.as_deref() {
            Ok(Power::Off(reason)) => reason.clone(),
            _ => None,
        }
    }

    /// Opens a connection to a port the guest listens on.
    pub(crate) async fn connect(&self, port: u32) -> Result<Connection> {
        let id = self.link.next.fetch_add(1, Ordering::Relaxed);
        let (answer, answered) = oneshot::channel();
        match self.link.waiting.lock().unwrap_or_else(PoisonError::into_inner).as_mut() {
            Some(waiting) => waiting.insert(id, answer),
            None => return Err(Error::Stopped),
        };
        self.link.send(&Request::Connect { id, port }).await?;
        let descriptor = answered.await.map_err(|_| Error::Stopped)??;
        Ok(Connection::new(descriptor, id, self.released.clone())?)
    }

    /// Asks the guest to run in `bytes` of memory.
    pub(crate) async fn balloon(&self, bytes: u64) -> Result<()> {
        self.link.send(&Request::Balloon { bytes }).await
    }

    /// Cuts the VM's power. Ask the agent to shut down first; this is for when it can't.
    pub(crate) async fn stop(&self) -> Result<()> {
        self.link.send(&Request::Stop).await
    }
}

impl Link {
    async fn send(&self, request: &Request) -> Result<()> {
        let mut line = serde_json::to_vec(request)?;
        line.push(b'\n');
        let _writing = self.writing.lock().await;
        let mut sent = 0;
        while sent < line.len() {
            self.socket.writable().await.map_err(|_| Error::Stopped)?;
            match self.socket.try_write(&line[sent..]) {
                Ok(count) => sent += count,
                Err(error) if error.kind() == io::ErrorKind::WouldBlock => {}
                Err(_) => return Err(Error::Stopped),
            }
        }
        Ok(())
    }
}

/// Where what the helper says without being asked goes.
struct Events {
    power: watch::Sender<Power>,
    accept: mpsc::UnboundedSender<Connection>,
    released: mpsc::UnboundedSender<u64>,
    changed: mpsc::UnboundedSender<Vec<FileEvent>>,
}

/// Reads the helper's lines until it is gone: answers go to whoever waits for them, events
/// become the VM's power state and the connections its guest opens.
async fn read(link: Arc<Link>, events: Events) {
    let mut text = Vec::new();
    let mut descriptors = VecDeque::new();
    while let Ok(()) = link.socket.readable().await {
        let mut bytes = [0; 4096];
        let mut space = [MaybeUninit::uninit(); rustix::cmsg_space!(ScmRights(8))];
        let mut ancillary = RecvAncillaryBuffer::new(&mut space);
        let received = link.socket.try_io(Interest::READABLE, || {
            let mut parts = [IoSliceMut::new(&mut bytes)];
            Ok(recvmsg(&link.socket, &mut parts, &mut ancillary, RecvFlags::empty())?)
        });
        let count = match received {
            Ok(message) if message.bytes == 0 => break,
            Ok(message) => message.bytes,
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => continue,
            Err(_) => break,
        };
        for message in ancillary.drain() {
            if let RecvAncillaryMessage::ScmRights(received) = message {
                descriptors.extend(received);
            }
        }
        text.extend_from_slice(&bytes[..count]);
        while let Some(end) = text.iter().position(|&byte| byte == b'\n') {
            let received: Vec<u8> = text.drain(..=end).collect();
            if let Ok(message) = serde_json::from_slice::<Message>(&received) {
                handle(&link, &events, message, &mut descriptors);
            }
        }
    }
    link.waiting.lock().unwrap_or_else(PoisonError::into_inner).take();
}

fn handle(link: &Link, events: &Events, message: Message, descriptors: &mut VecDeque<OwnedFd>) {
    // A descriptor travels with the line it belongs to, so they arrive in the same order.
    if let (Some(id), Some("accepted")) = (message.id, message.event.as_deref()) {
        let connection = descriptors
            .pop_front()
            .and_then(|descriptor| Connection::new(descriptor, id, events.released.clone()).ok());
        if let Some(connection) = connection {
            // Nobody takes them once the guest is being shut down; the drop closes it.
            let _ = events.accept.send(connection);
        }
        return;
    }
    if let Some(id) = message.id {
        let answer = match message.error {
            Some(error) => Err(Error::Engine(error)),
            None => descriptors.pop_front().ok_or(Error::Stopped),
        };
        let waiting = link
            .waiting
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .as_mut()
            .and_then(|waiting| waiting.remove(&id));
        if let Some(waiting) = waiting {
            let _ = waiting.send(answer);
        }
        return;
    }
    match message.event.as_deref() {
        Some("started") => {
            events.power.send_replace(Power::On);
        }
        Some("stopped") => {
            events.power.send_replace(Power::Off(message.error));
        }
        Some("changed") => {
            // Nobody listens once the guest is being shut down.
            let _ = events.changed.send(message.changes.unwrap_or_default());
        }
        _ => {}
    }
}
