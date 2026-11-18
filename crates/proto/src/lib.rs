//! What the engine on the Mac and the agent in its Linux guest say to each other.
//!
//! The guest listens on three ports of the VM's socket device. [`CONTROL_PORT`] carries calls both
//! ways (see [`rpc`]); [`DOCKER_PORT`] is Docker's own socket, byte for byte; a connection to
//! [`FORWARD_PORT`] starts with one [`Forward`] line and is then the connection it names. The
//! engine listens on one, [`HOST_PORT`]: a connection the guest makes to it starts with one
//! [`Reach`] line and is then a connection to that place on the Mac.

pub mod datagram;
pub mod rpc;

use std::net::{IpAddr, Ipv4Addr, SocketAddr};

use serde::{Deserialize, Serialize};

pub const CONTROL_PORT: u32 = 5001;
pub const DOCKER_PORT: u32 = 5002;
pub const FORWARD_PORT: u32 = 5003;
pub const HOST_PORT: u32 = 5004;

/// The Mac, as containers reach it: what `host.docker.internal` resolves to. No machine has this
/// address; it is from the range set aside for testing networks, which no network a Mac joins
/// uses. The guest takes what containers send to it and carries it to the Mac.
pub const MAC: Ipv4Addr = Ipv4Addr::new(198, 18, 0, 1);

/// What the engine asks of the agent. Each variant's doc names the answer it gets.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum EngineCall {
    /// Finishes starting the guest and Docker. Answer: [`Booted`], once Docker answers.
    Boot(Boot),
    /// Answer: [`Stats`].
    Stats,
    /// Sets the guest's clock, which stands still while the Mac sleeps. Answer: `()`.
    SetClock { unix_millis: u64 },
    /// Files changed on the Mac in folders containers have mounted, oldest first. Answer: `()`,
    /// once whoever watches them in the guest has been told.
    Changed(Vec<Change>),
    /// Answer: the cluster's kubeconfig as k3s writes it for [`Kubernetes::Start`], once its API
    /// answers; `()` for the others.
    Kubernetes(Kubernetes),
    /// Stops Docker and its containers, then powers the guest off. Answer: `()`, before the power
    /// goes.
    Shutdown,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Kubernetes {
    /// Runs this k3s release, fetching it the first time. Starting a running cluster only
    /// answers with its kubeconfig again.
    Start { version: String },
    /// Stops k3s and its pods. The cluster's objects are kept for the next start.
    Stop,
    /// Stops k3s and deletes everything the cluster stored.
    Reset,
}

/// What the agent asks of the engine. Each is answered with `()`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AgentCall {
    /// A container publishes a port: listen for it on the Mac. An error fails the container's
    /// start, with its text shown to whoever started it.
    Publish(Port),
    /// The container behind a published port is gone.
    Unpublish(Port),
    /// These folders of the Mac, and no others, are mounted in running containers: report what
    /// changes in them with [`EngineCall::Changed`].
    Watch(Vec<String>),
}

/// One change to a file or folder on the Mac. Several in a row can describe one act: a file
/// saved by writing a new one over it appears, and its contents change.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Change {
    /// The same path on the Mac and in the guest.
    pub path: String,
    pub what: Changed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Changed {
    /// The path is new: it was created, or something was renamed to it.
    Appeared,
    Contents,
    /// Its permissions, owner or times.
    Attributes,
    /// The path is no more: it was deleted, or renamed to something else.
    Gone {
        folder: bool,
    },
}

/// The Mac's SSH agent, as a socket in the guest. A container that mounts it and names it in
/// `SSH_AUTH_SOCK` uses the keys the Mac's agent holds. The path is the one Docker Desktop uses,
/// so what was written for that works here.
pub const SSH_AGENT: &str = "/run/host-services/ssh-auth.sock";

/// What the engine sends on a connection to [`HOST_PORT`] once it is connected to the place its
/// [`Reach`] names. A connection that closes without it reached nothing.
pub const REACHED: u8 = 1;

/// The first line of a connection the guest makes to [`HOST_PORT`]: where on the Mac it goes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Reach {
    /// The SSH agent that holds the user's keys.
    SshAgent,
    /// A server listening on the Mac itself, as `localhost` reaches it there.
    Tcp { port: u16 },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Boot {
    pub hostname: String,
    /// The Mac's clock, since the guest has no other and loses time while the Mac sleeps.
    pub unix_seconds: u64,
    pub shares: Vec<Share>,
    /// Folders inside the shares that the Mac also knows by another path, such as `/var/folders`
    /// for `/private/var/folders`.
    pub aliases: Vec<Alias>,
    /// The virtiofs tag Rosetta is shared under, when Intel images should run through it.
    pub rosetta: Option<String>,
    /// Docker's `daemon.json`.
    pub docker: serde_json::Value,
}

/// A Mac folder, mounted in the guest at the same path so bind mounts mean the same on both sides.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Share {
    pub tag: String,
    pub path: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Alias {
    pub path: String,
    pub target: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Booted {
    pub kernel: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Stats {
    pub memory_total: u64,
    /// What Linux could hand out without swapping: free memory and the file cache it would drop.
    pub memory_available: u64,
    /// What the balloon holds: memory the guest has but may not use.
    pub memory_ballooned: u64,
    /// Share of the last ten seconds some task waited for memory, in percent.
    pub memory_pressure: f32,
    /// Whether anything but the engine itself runs: a container, a build, a pod.
    pub busy: bool,
    /// The guest's clock, in milliseconds since 1970.
    pub unix_millis: u64,
}

impl Stats {
    /// What the guest's work holds, in bytes: neither file cache nor the balloon.
    #[must_use]
    pub const fn memory_used(&self) -> u64 {
        self.memory_total
            .saturating_sub(self.memory_available)
            .saturating_sub(self.memory_ballooned)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Transport {
    Tcp,
    Udp,
}

/// One published port, as Docker describes it to its port proxy.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Port {
    pub transport: Transport,
    pub host_ip: IpAddr,
    pub host_port: u16,
    pub container_ip: IpAddr,
    pub container_port: u16,
}

impl Port {
    /// Where the Mac listens.
    #[must_use]
    pub const fn host(&self) -> SocketAddr {
        SocketAddr::new(self.host_ip, self.host_port)
    }

    /// Where the container listens, as seen from the guest.
    #[must_use]
    pub const fn container(&self) -> SocketAddr {
        SocketAddr::new(self.container_ip, self.container_port)
    }
}

/// The first line of a connection to [`FORWARD_PORT`]: where in the guest it goes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Forward {
    pub transport: Transport,
    pub to: SocketAddr,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_neither_cache_nor_the_balloon_as_used() {
        let stats = Stats {
            memory_total: 8 << 30,
            memory_available: 2 << 30,
            memory_ballooned: 5 << 30,
            memory_pressure: 0.0,
            busy: false,
            unix_millis: 0,
        };
        assert_eq!(stats.memory_used(), 1 << 30);
    }

    #[test]
    fn a_port_names_both_ends() {
        let port = Port {
            transport: Transport::Tcp,
            host_ip: "127.0.0.1".parse().unwrap(),
            host_port: 8080,
            container_ip: "172.17.0.2".parse().unwrap(),
            container_port: 80,
        };
        assert_eq!(port.host().to_string(), "127.0.0.1:8080");
        assert_eq!(port.container().to_string(), "172.17.0.2:80");
    }
}
