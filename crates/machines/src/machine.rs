use std::collections::HashMap;
use std::path::Path;

use http::Method;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::catalogue::DISTROS;
use crate::client::Incus;
use crate::name::validate_name;
use crate::{Error, Result};

const IMAGES_SERVER: &str = "https://images.linuxcontainers.org";
const HOME_DEVICE: &str = "home";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum MachineKind {
    /// A system container: shares the engine's kernel, boots in about a second.
    Container,
    /// A full VM with its own kernel. Needs nested virtualization (M3 or newer).
    Vm,
}

impl MachineKind {
    const fn incus_name(self) -> &'static str {
        match self {
            Self::Container => "container",
            Self::Vm => "virtual-machine",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum MachineState {
    Running,
    Stopped,
    Frozen,
    Error,
    Busy,
}

impl From<&str> for MachineState {
    fn from(status: &str) -> Self {
        match status {
            "Running" => Self::Running,
            "Stopped" => Self::Stopped,
            "Frozen" => Self::Frozen,
            "Error" => Self::Error,
            _ => Self::Busy,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Machine {
    pub name: String,
    /// As the image names it: "Ubuntu", "Debian", "Archlinux".
    pub distro: String,
    pub release: String,
    pub kind: MachineKind,
    pub state: MachineState,
    pub ipv4: Option<String>,
    #[specta(type = specta_typescript::Number)]
    pub memory_bytes: u64,
    /// CPU time since start; two readings give a percentage.
    pub cpu_seconds: f64,
    pub processes: u32,
    pub cpu_limit: Option<String>,
    pub memory_limit: Option<String>,
    /// The Mac folder mounted into the machine, if any.
    pub home: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Deserialize)]
struct RawInstance {
    name: String,
    status: String,
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    created_at: String,
    #[serde(default)]
    config: HashMap<String, String>,
    #[serde(default)]
    devices: HashMap<String, HashMap<String, String>>,
    state: Option<RawState>,
}

#[derive(Debug, Default, Deserialize)]
struct RawState {
    #[serde(default)]
    memory: RawUsage,
    #[serde(default)]
    cpu: RawUsage,
    #[serde(default)]
    processes: i64,
    network: Option<HashMap<String, RawNetwork>>,
}

#[derive(Debug, Default, Deserialize)]
struct RawUsage {
    #[serde(default)]
    usage: i64,
}

#[derive(Debug, Deserialize)]
struct RawNetwork {
    #[serde(default)]
    addresses: Vec<RawAddress>,
}

#[derive(Debug, Deserialize)]
struct RawAddress {
    family: String,
    address: String,
    scope: String,
}

impl From<RawInstance> for Machine {
    fn from(raw: RawInstance) -> Self {
        let state = raw.state.unwrap_or_default();
        let config = |key: &str| raw.config.get(key).filter(|value| !value.is_empty()).cloned();
        Self {
            distro: config("image.os").unwrap_or_else(|| "Linux".to_owned()),
            release: config("image.version")
                .or_else(|| config("image.release"))
                .unwrap_or_default(),
            kind: if raw.kind == "virtual-machine" {
                MachineKind::Vm
            } else {
                MachineKind::Container
            },
            state: MachineState::from(raw.status.as_str()),
            ipv4: ipv4(state.network.as_ref()),
            memory_bytes: u64::try_from(state.memory.usage).unwrap_or(0),
            cpu_seconds: nanos_to_seconds(state.cpu.usage),
            processes: u32::try_from(state.processes).unwrap_or(0),
            cpu_limit: config("limits.cpu"),
            memory_limit: config("limits.memory"),
            home: raw.devices.get(HOME_DEVICE).and_then(|device| device.get("source")).cloned(),
            created_at: raw.created_at,
            name: raw.name,
        }
    }
}

#[expect(clippy::cast_precision_loss, reason = "CPU nanoseconds fit comfortably in an f64")]
fn nanos_to_seconds(nanos: i64) -> f64 {
    nanos.max(0) as f64 / 1e9
}

/// The machine's address on the engine's bridge: the first global IPv4 outside loopback.
fn ipv4(network: Option<&HashMap<String, RawNetwork>>) -> Option<String> {
    let mut interfaces: Vec<_> = network?.iter().filter(|(name, _)| *name != "lo").collect();
    interfaces.sort_by_key(|(name, _)| *name);
    interfaces.into_iter().flat_map(|(_, interface)| &interface.addresses).find_map(|address| {
        (address.family == "inet" && address.scope == "global").then(|| address.address.clone())
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum MachineAction {
    Start,
    Stop,
    Restart,
}

/// What the new-machine sheet asks for.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CreateMachine {
    pub name: String,
    pub distro: String,
    pub release: String,
    pub kind: MachineKind,
    pub cpus: u16,
    pub memory_gib: u16,
    pub mount_home: bool,
}

impl CreateMachine {
    /// The Incus request, after checking the name, the image and the resources.
    fn body(&self, home: Option<&Path>) -> Result<Value> {
        validate_name(&self.name)?;
        let image = DISTROS
            .iter()
            .find(|distro| distro.id == self.distro)
            .and_then(|distro| distro.image(&self.release))
            .ok_or_else(|| {
                Error::Invalid(format!("{} {} isn't available.", self.distro, self.release))
            })?;
        if self.cpus == 0 || self.memory_gib == 0 {
            return Err(Error::Invalid("Give the machine at least one CPU and 1 GB.".to_owned()));
        }
        let mut devices = serde_json::Map::new();
        if let (true, Some(home)) = (self.mount_home, home) {
            let home = home.to_string_lossy();
            devices.insert(
                HOME_DEVICE.to_owned(),
                json!({ "type": "disk", "source": home, "path": home }),
            );
        }
        Ok(json!({
            "name": self.name,
            "type": self.kind.incus_name(),
            "source": { "type": "image", "alias": image, "server": IMAGES_SERVER, "protocol": "simplestreams" },
            "config": { "limits.cpu": self.cpus.to_string(), "limits.memory": format!("{}GiB", self.memory_gib) },
            "devices": devices,
            "start": true,
        }))
    }
}

impl Incus {
    /// Every machine with its live state, by name.
    ///
    /// # Errors
    /// Fails when Incus can't be reached.
    pub async fn machines(&self) -> Result<Vec<Machine>> {
        let raw: Vec<RawInstance> = self.get("/1.0/instances?recursion=2").await?;
        let mut machines: Vec<Machine> = raw.into_iter().map(Machine::from).collect();
        machines.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(machines)
    }

    /// # Errors
    /// Fails when the machine doesn't exist.
    pub async fn machine(&self, name: &str) -> Result<Machine> {
        validate_name(name)?;
        let raw: RawInstance = self.get(&format!("/1.0/instances/{name}?recursion=1")).await?;
        let state: RawState = self.get(&format!("/1.0/instances/{name}/state")).await?;
        Ok(Machine::from(RawInstance { state: Some(state), ..raw }))
    }

    /// Downloads the image if needed, creates the machine and starts it, reporting progress.
    ///
    /// # Errors
    /// Fails on an invalid request or when Incus refuses it.
    pub async fn create(
        &self,
        request: &CreateMachine,
        home: Option<&Path>,
        on_progress: impl FnMut(String),
    ) -> Result<()> {
        let body = request.body(home)?;
        let operation = self.start(Method::POST, "/1.0/instances", Some(&body)).await?;
        self.wait(&operation, on_progress).await
    }

    /// # Errors
    /// Fails when the machine doesn't exist or Incus refuses.
    pub async fn act(&self, name: &str, action: MachineAction) -> Result<()> {
        validate_name(name)?;
        let action = match action {
            MachineAction::Start => "start",
            MachineAction::Stop => "stop",
            MachineAction::Restart => "restart",
        };
        let body = json!({ "action": action, "timeout": 30, "force": false });
        self.run(Method::PUT, &format!("/1.0/instances/{name}/state"), Some(&body)).await
    }

    /// Stops the machine if it runs, then deletes it and its disk.
    ///
    /// # Errors
    /// Fails when the machine doesn't exist or Incus refuses.
    pub async fn delete(&self, name: &str) -> Result<()> {
        let machine = self.machine(name).await?;
        if machine.state != MachineState::Stopped {
            let body = json!({ "action": "stop", "timeout": 10, "force": true });
            self.run(Method::PUT, &format!("/1.0/instances/{name}/state"), Some(&body)).await?;
        }
        self.run(Method::DELETE, &format!("/1.0/instances/{name}"), None).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const INSTANCE: &str = r#"{
        "architecture": "aarch64",
        "config": {
            "image.architecture": "arm64",
            "image.description": "Ubuntu noble arm64 (20261016_07:42)",
            "image.os": "Ubuntu",
            "image.release": "noble",
            "image.version": "24.04",
            "limits.cpu": "2",
            "limits.memory": "4GiB",
            "volatile.base_image": "4a5b0f"
        },
        "created_at": "2026-10-16T09:12:44.512331Z",
        "description": "",
        "devices": { "home": { "path": "/Users/ada", "source": "/Users/ada", "type": "disk" } },
        "ephemeral": false,
        "name": "ubuntu-dev",
        "profiles": ["default"],
        "project": "default",
        "stateful": false,
        "status": "Running",
        "status_code": 103,
        "type": "container",
        "state": {
            "status": "Running",
            "status_code": 103,
            "disk": {},
            "memory": { "usage": 325058560, "usage_peak": 0, "total": 0, "swap_usage": 0, "swap_usage_peak": 0 },
            "network": {
                "eth0": { "addresses": [
                    { "family": "inet", "address": "10.214.83.12", "netmask": "24", "scope": "global" },
                    { "family": "inet6", "address": "fe80::216:3eff:fe1d:2", "netmask": "64", "scope": "link" }
                ], "counters": {}, "hwaddr": "00:16:3e:1d:00:02", "host_name": "veth1", "mtu": 1500, "state": "up", "type": "broadcast" },
                "lo": { "addresses": [{ "family": "inet", "address": "127.0.0.1", "netmask": "8", "scope": "local" }],
                    "counters": {}, "hwaddr": "", "host_name": "", "mtu": 65536, "state": "up", "type": "loopback" }
            },
            "pid": 4120,
            "processes": 31,
            "cpu": { "usage": 2500000000, "allocated_time": 0 }
        }
    }"#;

    fn request(kind: MachineKind) -> CreateMachine {
        CreateMachine {
            name: "dev".into(),
            distro: "debian".into(),
            release: "13".into(),
            kind,
            cpus: 2,
            memory_gib: 4,
            mount_home: true,
        }
    }

    #[test]
    fn reads_an_instance_with_its_state() {
        let machine = Machine::from(serde_json::from_str::<RawInstance>(INSTANCE).unwrap());
        assert_eq!(machine.name, "ubuntu-dev");
        assert_eq!((machine.distro.as_str(), machine.release.as_str()), ("Ubuntu", "24.04"));
        assert_eq!(machine.kind, MachineKind::Container);
        assert_eq!(machine.state, MachineState::Running);
        assert_eq!(machine.ipv4.as_deref(), Some("10.214.83.12"));
        assert_eq!(machine.memory_bytes, 325_058_560);
        assert!((machine.cpu_seconds - 2.5).abs() < f64::EPSILON);
        assert_eq!(machine.processes, 31);
        assert_eq!(machine.memory_limit.as_deref(), Some("4GiB"));
        assert_eq!(machine.home.as_deref(), Some("/Users/ada"));
    }

    #[test]
    fn a_stopped_instance_has_no_address_or_usage() {
        let raw = r#"{"name":"arch","status":"Stopped","type":"virtual-machine","config":{},"devices":{},
            "state":{"status":"Stopped","memory":{"usage":0},"cpu":{"usage":-1},"processes":-1,"network":null}}"#;
        let machine = Machine::from(serde_json::from_str::<RawInstance>(raw).unwrap());
        assert_eq!(machine.kind, MachineKind::Vm);
        assert_eq!(machine.state, MachineState::Stopped);
        assert_eq!((machine.ipv4, machine.processes, machine.distro.as_str()), (None, 0, "Linux"));
        assert!(machine.cpu_seconds.abs() < f64::EPSILON);
    }

    #[test]
    fn builds_the_create_request() {
        let body = request(MachineKind::Vm).body(Some(Path::new("/Users/ada"))).unwrap();
        assert_eq!(body["type"], "virtual-machine");
        assert_eq!(body["source"]["alias"], "debian/13");
        assert_eq!(body["source"]["protocol"], "simplestreams");
        assert_eq!(body["config"]["limits.memory"], "4GiB");
        assert_eq!(body["devices"]["home"]["path"], "/Users/ada");
        assert_eq!(body["start"], true);
    }

    #[test]
    fn leaves_the_home_folder_out_when_asked() {
        let body = CreateMachine { mount_home: false, ..request(MachineKind::Container) }
            .body(Some(Path::new("/Users/ada")))
            .unwrap();
        assert_eq!(body["type"], "container");
        assert_eq!(body["devices"], json!({}));
    }

    #[test]
    fn refuses_unknown_images_bad_names_and_no_resources() {
        let unknown = CreateMachine { release: "7".into(), ..request(MachineKind::Container) };
        assert!(matches!(unknown.body(None), Err(Error::Invalid(_))));
        let bad_name = CreateMachine { name: "Dev Box".into(), ..request(MachineKind::Container) };
        assert!(matches!(bad_name.body(None), Err(Error::Invalid(_))));
        let empty = CreateMachine { cpus: 0, ..request(MachineKind::Container) };
        assert!(matches!(empty.body(None), Err(Error::Invalid(_))));
    }
}
