//! Kubernetes in the guest: k3s, run beside Docker and using it for its containers, so an image
//! built with Docker is there for a pod without a registry.

use std::collections::HashMap;
use std::fs;
use std::net::{IpAddr, Ipv4Addr, UdpSocket};
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use contena_agent::kube::{ServiceEvent, published_checksum, release_urls};
use contena_proto::{AgentCall, Port};
use rustix::mount::{MountFlags, UnmountFlags, mount, unmount};
use rustix::process::{Pid, Signal, kill_process};
use serde_json::Value;
use tokio::io::AsyncReadExt;
use tokio::process::{Child, Command};
use tokio::sync::watch;
use tokio::task::JoinHandle;

use crate::error::{Doing, Error, Result};
use crate::serve::Engine;
use crate::{docker, log};

/// Releases, kept across restarts so each is fetched once, and k3s's own log.
const HOME: &str = "/var/lib/contena/k3s";
const LOG: &str = "/var/lib/contena/k3s/k3s.log";
const KUBECONFIG: &str = "/run/k3s.yaml";
/// Everything a cluster stores. All of it is on the data disk.
const STATE: [&str; 3] = ["/var/lib/rancher", "/var/lib/kubelet", "/var/lib/cni"];
/// k3s keeps its node's identity under `/etc`, which is memory here: it is kept on the data disk
/// instead, or the cluster would refuse its own node after a restart.
const IDENTITY: (&str, &str) = ("/etc/rancher", "/var/lib/rancher/etc");
/// The first start pulls the cluster's own images, which a slow network makes slow.
const READY_PATIENCE: Duration = Duration::from_mins(10);
const STOP_PATIENCE: Duration = Duration::from_secs(30);

pub(crate) struct K3s {
    pub(crate) kubeconfig: String,
    stop: watch::Sender<bool>,
    stopped: JoinHandle<()>,
}

impl K3s {
    /// Runs `version`, fetching it first if this guest never ran it, and returns once the
    /// cluster's API answers.
    pub(crate) async fn start(version: &str, engine: Engine) -> Result<Self> {
        let binary = fetch(version).await?;
        for folder in [IDENTITY.0, IDENTITY.1] {
            fs::create_dir_all(folder).doing(format!("create {folder}"))?;
        }
        if !mounted(IDENTITY.0) {
            mount(IDENTITY.1, IDENTITY.0, "", MountFlags::BIND, None)
                .doing("keep the node's identity")?;
        }
        let mut server = spawn(&binary)?;
        tokio::select! {
            ready = tokio::time::timeout(READY_PATIENCE, answering(&binary)) => {
                if ready.is_err() {
                    terminate(server).await;
                    return Err(Error::Failed(format!(
                        "Kubernetes didn't answer within ten minutes. Its log is {LOG} in the engine."
                    )));
                }
            }
            status = server.wait() => {
                let status = status.doing("wait for k3s")?;
                return Err(Error::Failed(format!(
                    "k3s stopped as it started ({status}). Its log is {LOG} in the engine."
                )));
            }
        }
        let kubeconfig = fs::read_to_string(KUBECONFIG).doing("read the kubeconfig")?;
        let (stop, stopping) = watch::channel(false);
        let stopped = tokio::spawn(run(server, binary, stopping, engine));
        Ok(Self { kubeconfig, stop, stopped })
    }

    /// Stops k3s. With `pods`, stops what it ran too; without, Docker stopping takes them along.
    pub(crate) async fn stop(self, pods: bool) {
        let _ = self.stop.send(true);
        let _ = self.stopped.await;
        if pods {
            remove_pods().await;
        }
    }
}

/// Deletes everything a stopped cluster stored.
pub(crate) fn forget() -> Result<()> {
    let mounts = fs::read_to_string("/proc/mounts").unwrap_or_default();
    let mut inside: Vec<&str> = mounts
        .lines()
        .filter_map(|line| line.split_whitespace().nth(1))
        .filter(|at| STATE.iter().any(|folder| at.starts_with(folder)) || *at == IDENTITY.0)
        .collect();
    // Deepest first, so nothing is unmounted from under what it holds.
    inside.sort_unstable_by_key(|at| std::cmp::Reverse(at.len()));
    for at in inside {
        unmount(at, UnmountFlags::DETACH).doing(format!("unmount {at}"))?;
    }
    for folder in STATE {
        match fs::remove_dir_all(folder) {
            Err(error) if error.kind() != std::io::ErrorKind::NotFound => {
                return Err(error).doing(format!("delete {folder}"));
            }
            _ => {}
        }
    }
    Ok(())
}

fn mounted(at: &str) -> bool {
    fs::read_to_string("/proc/mounts")
        .is_ok_and(|mounts| mounts.lines().any(|line| line.split_whitespace().nth(1) == Some(at)))
}

/// The k3s binary for `version`, downloaded and checked against the release's checksum the first
/// time.
async fn fetch(version: &str) -> Result<PathBuf> {
    let plain = |character: char| character.is_ascii_alphanumeric() || ".+-".contains(character);
    if version.is_empty() || !version.chars().all(plain) {
        return Err(Error::Failed(format!(
            "{version:?} is not a k3s release, such as v1.37.2+k3s1."
        )));
    }
    let folder = Path::new(HOME).join(version);
    let binary = folder.join("k3s");
    if binary.is_file() {
        return Ok(binary);
    }
    fs::create_dir_all(&folder).doing("create the k3s folder")?;
    let partial = folder.join("k3s.partial");
    let sums = folder.join("sums");
    let (binary_url, sums_url) = release_urls(version);
    log(format_args!("fetching k3s {version}"));
    for (url, to) in [(&binary_url, &partial), (&sums_url, &sums)] {
        let fetched = Command::new("curl")
            .args(["--fail", "--silent", "--show-error", "--location", "--retry", "3"])
            .args(["--connect-timeout", "20", "--output"])
            .arg(to)
            .arg(url)
            .status()
            .await
            .doing("run curl")?;
        if !fetched.success() {
            return Err(Error::Failed(format!(
                "k3s {version} couldn't be downloaded. Check that it is an exact k3s release and that the Mac is online."
            )));
        }
    }
    let wanted = fs::read_to_string(&sums).doing("read the checksums")?;
    let summed = Command::new("sha256sum").arg(&partial).output().await.doing("run sha256sum")?;
    let actual = String::from_utf8_lossy(&summed.stdout);
    if published_checksum(&wanted).is_none_or(|sum| Some(sum) != actual.split_whitespace().next()) {
        let _ = fs::remove_file(&partial);
        return Err(Error::Failed(format!(
            "The download of k3s {version} doesn't match its published checksum. Try again."
        )));
    }
    fs::set_permissions(&partial, fs::Permissions::from_mode(0o755)).doing("make k3s runnable")?;
    fs::rename(&partial, &binary).doing("keep k3s")?;
    Ok(binary)
}

fn spawn(binary: &Path) -> Result<Child> {
    Command::new(binary)
        .args(["server", "--docker", "--disable=traefik", "--node-name=contena"])
        .args(["--write-kubeconfig", KUBECONFIG, "--write-kubeconfig-mode=600", "--log", LOG])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .doing("start k3s")
}

fn kubectl(binary: &Path) -> Command {
    let mut kubectl = Command::new(binary);
    kubectl.args(["kubectl", "--kubeconfig", KUBECONFIG]).stderr(Stdio::null());
    kubectl
}

async fn answering(binary: &Path) {
    loop {
        let ready = kubectl(binary).args(["get", "--raw", "/readyz"]).output().await;
        if ready.is_ok_and(|ready| ready.status.success() && ready.stdout == b"ok") {
            return;
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
}

/// Keeps k3s running and its services' ports published on the Mac, until asked to stop.
async fn run(
    mut server: Child,
    binary: PathBuf,
    mut stopping: watch::Receiver<bool>,
    engine: Engine,
) {
    let mut published = HashMap::new();
    loop {
        tokio::select! {
            status = server.wait() => {
                log(format_args!("k3s ended on its own ({status:?}); starting it again"));
                tokio::time::sleep(Duration::from_secs(2)).await;
                match spawn(&binary) {
                    Ok(started) => server = started,
                    Err(error) => {
                        log(error);
                        break;
                    }
                }
            }
            () = watch_services(&binary, &engine, &mut published) => {}
            _ = stopping.changed() => {
                terminate(server).await;
                break;
            }
        }
    }
    for port in published.into_values().flatten() {
        let _ = engine.call(AgentCall::Unpublish(port)).await;
    }
}

/// Follows the cluster's services and asks the engine for the ports they want on the Mac.
/// Returns when the watch ends, as it does when k3s restarts; the caller starts it again.
async fn watch_services(
    binary: &Path,
    engine: &Engine,
    published: &mut HashMap<String, Vec<Port>>,
) {
    let watch = ["get", "services", "--all-namespaces", "--watch", "--output-watch-events"];
    let mut watching = match kubectl(binary)
        .args(watch)
        .args(["--output", "json"])
        .stdout(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
    {
        Ok(watching) => watching,
        Err(error) => {
            log(format_args!("services can't be watched: {error}"));
            return tokio::time::sleep(Duration::from_secs(5)).await;
        }
    };
    let Some(mut output) = watching.stdout.take() else { return };
    let node = node_address();
    let mut text = Vec::new();
    let mut chunk = [0; 8192];
    while let Ok(count @ 1..) = output.read(&mut chunk).await {
        text.extend_from_slice(&chunk[..count]);
        // kubectl prints one JSON object per event, back to back, each over many lines.
        let mut events = serde_json::Deserializer::from_slice(&text).into_iter::<Value>();
        let mut read = 0;
        while let Some(Ok(event)) = events.next() {
            read = events.byte_offset();
            if let Some(event) = ServiceEvent::read(&event) {
                apply(event, node, engine, published).await;
            }
        }
        text.drain(..read);
    }
    tokio::time::sleep(Duration::from_secs(2)).await;
}

async fn apply(
    event: ServiceEvent,
    node: IpAddr,
    engine: &Engine,
    published: &mut HashMap<String, Vec<Port>>,
) {
    let local = IpAddr::V4(Ipv4Addr::LOCALHOST);
    let wanted: Vec<Port> = event
        .ports
        .into_iter()
        .map(|(transport, port)| Port {
            transport,
            host_ip: local,
            host_port: port,
            container_ip: node,
            container_port: port,
        })
        .collect();
    let before = published.remove(&event.service).unwrap_or_default();
    for port in before.iter().filter(|port| !wanted.contains(port)) {
        let _ = engine.call(AgentCall::Unpublish(*port)).await;
    }
    let mut now = Vec::new();
    for port in wanted {
        if before.contains(&port) {
            now.push(port);
            continue;
        }
        match engine.call(AgentCall::Publish(port)).await {
            Ok(()) => now.push(port),
            Err(reason) => {
                log(format_args!("service {} isn't on the Mac: {reason}", event.service));
            }
        }
    }
    if !now.is_empty() {
        published.insert(event.service, now);
    }
}

/// The guest's own address, where node ports and load balancers answer. Found by asking which
/// address a packet out would leave from; nothing is sent.
fn node_address() -> IpAddr {
    UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0))
        .and_then(|socket| {
            socket.connect((Ipv4Addr::new(192, 0, 2, 1), 9))?;
            socket.local_addr()
        })
        .map_or(IpAddr::V4(Ipv4Addr::LOCALHOST), |address| address.ip())
}

async fn terminate(mut server: Child) {
    let pid = server.id().and_then(|id| i32::try_from(id).ok()).and_then(Pid::from_raw);
    if let Some(pid) = pid {
        let _ = kill_process(pid, Signal::TERM);
    }
    if tokio::time::timeout(STOP_PATIENCE, server.wait()).await.is_err() {
        let _ = server.kill().await;
    }
}

/// k3s leaves its pods' containers running when it stops, as a node that restarts would want.
/// Turning Kubernetes off means them too.
async fn remove_pods() {
    // `{"label":["io.kubernetes.pod.namespace"]}`: every container a pod owns carries it.
    let pods = "/containers/json?all=true&filters=%7B%22label%22%3A%5B%22io.kubernetes.pod.namespace%22%5D%7D";
    let Ok(listed) = docker::api("GET", pods).await else { return };
    let Ok(Value::Array(containers)) = serde_json::from_slice::<Value>(&listed) else { return };
    for id in containers.iter().filter_map(|container| container["Id"].as_str()) {
        let _ = docker::api("DELETE", &format!("/containers/{id}?force=true")).await;
    }
}
