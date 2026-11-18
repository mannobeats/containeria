//! Kubernetes on the Mac's side: asking the guest to run k3s, publishing its API and keeping the
//! kubeconfig `kubectl` reads in step.

use std::fs;
use std::net::{IpAddr, Ipv4Addr};
use std::os::unix::fs::PermissionsExt;
use std::path::PathBuf;

use contena_proto::{EngineCall, Kubernetes, Port, Transport};

use super::guest::Guest;
use super::kubeconfig;
use super::ports::Ports;
use crate::error::{Error, Result};

/// Where k3s serves its API inside the guest.
const API: u16 = 6443;
/// How many ports after 6443 are tried on the Mac when another cluster already has it.
const TRIES: u16 = 20;

/// Starts the cluster in `guest` and returns the port its API answers on at `127.0.0.1`:
/// `published` when it already has one. With `select` it becomes `kubectl`'s current cluster.
pub(crate) async fn start(
    guest: &Guest,
    ports: &Ports,
    published: Option<Port>,
    version: &str,
    select: bool,
) -> Result<Port> {
    let start = Kubernetes::Start { version: version.to_owned() };
    let cluster: String = guest.agent.call(&EngineCall::Kubernetes(start)).await?;
    let port = match published {
        Some(port) => port,
        None => publish(guest, ports)?,
    };
    rewrite(|existing| kubeconfig::with_cluster(existing, &cluster, port.host_port, select))?;
    Ok(port)
}

/// Stops the cluster and takes it out of the kubeconfig.
pub(crate) async fn stop(guest: &Guest) -> Result<()> {
    guest.agent.call::<_, ()>(&EngineCall::Kubernetes(Kubernetes::Stop)).await?;
    rewrite(kubeconfig::without_cluster)
}

/// Stops the cluster and deletes what it stored.
pub(crate) async fn forget(guest: &Guest) -> Result<()> {
    Ok(guest.agent.call(&EngineCall::Kubernetes(Kubernetes::Reset)).await?)
}

/// Listens for the API on the Mac: on 6443, or the next free port when another cluster has it.
fn publish(guest: &Guest, ports: &Ports) -> Result<Port> {
    let local = IpAddr::V4(Ipv4Addr::LOCALHOST);
    let mut reason = String::new();
    for host_port in API..API + TRIES {
        let port = Port {
            transport: Transport::Tcp,
            host_ip: local,
            host_port,
            container_ip: local,
            container_port: API,
        };
        match ports.publish(port, &guest.vmm) {
            Ok(()) => return Ok(port),
            Err(error) => reason = error,
        }
    }
    Err(Error::Engine(format!("The Kubernetes API has no port on the Mac. {reason}")))
}

/// The file `kubectl` reads first: the first entry of `$KUBECONFIG`, else `~/.kube/config`.
fn path() -> Result<PathBuf> {
    let named = std::env::var_os("KUBECONFIG")
        .and_then(|list| std::env::split_paths(&list).find(|path| !path.as_os_str().is_empty()));
    match named {
        Some(path) => Ok(path),
        None => Ok(std::env::home_dir().ok_or(Error::NoHomeFolder)?.join(".kube/config")),
    }
}

/// Replaces `~/.kube/config` with what `change` makes of it, kept private to the user as
/// `kubectl` keeps it.
fn rewrite(change: impl FnOnce(&str) -> yaml_serde::Result<String>) -> Result<()> {
    let path = path()?;
    let existing = match fs::read_to_string(&path) {
        Ok(existing) => existing,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(error) => return Err(error.into()),
    };
    let changed = change(&existing)
        .map_err(|error| Error::Engine(format!("{} can't be read: {error}", path.display())))?;
    if let Some(folder) = path.parent() {
        fs::create_dir_all(folder)?;
    }
    let new = path.with_extension("contena");
    fs::write(&new, changed)?;
    fs::set_permissions(&new, fs::Permissions::from_mode(0o600))?;
    Ok(fs::rename(new, path)?)
}
