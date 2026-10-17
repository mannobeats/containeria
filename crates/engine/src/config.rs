use std::collections::BTreeMap;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::error::Result;
use crate::home::Profile;

/// The k3s release Colima v0.10.3 ships as its default.
pub const K3S_DEFAULT_VERSION: &str = "v1.35.0+k3s1";

/// Apple Virtualization keeps Rosetta; krunkit gives freed memory back to macOS. The choice is
/// fixed when the engine is created.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum VmType {
    #[default]
    Vz,
    Krunkit,
}

impl VmType {
    #[must_use]
    pub const fn returns_memory(self) -> bool {
        matches!(self, Self::Krunkit)
    }

    const fn colima_name(self) -> &'static str {
        match self {
            Self::Vz => "vz",
            Self::Krunkit => "krunkit",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Kubernetes {
    pub enabled: bool,
    pub version: String,
}

impl Default for Kubernetes {
    fn default() -> Self {
        Self { enabled: false, version: K3S_DEFAULT_VERSION.to_owned() }
    }
}

/// The settings people change. Everything else in `colima.yaml` is Containeria's choice.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
#[expect(clippy::struct_excessive_bools, reason = "each flag is one independent engine setting")]
pub struct EngineConfig {
    pub cpus: u16,
    pub memory_gib: u16,
    pub disk_gib: u16,
    pub vm_type: VmType,
    pub rosetta: bool,
    pub kubernetes: Kubernetes,
    pub file_watch_events: bool,
    pub forward_ssh_agent: bool,
    pub udp_ports: bool,
    pub container_ip_access: bool,
    pub set_docker_context: bool,
}

impl Default for EngineConfig {
    fn default() -> Self {
        let cores = std::thread::available_parallelism().map_or(4, std::num::NonZero::get);
        Self {
            cpus: u16::try_from(cores / 2).unwrap_or(4).max(2),
            memory_gib: 8,
            disk_gib: 100,
            vm_type: VmType::default(),
            rosetta: true,
            kubernetes: Kubernetes::default(),
            file_watch_events: true,
            forward_ssh_agent: true,
            udp_ports: false,
            container_ip_access: false,
            set_docker_context: true,
        }
    }
}

impl EngineConfig {
    /// Reads the settings back from a profile's `colima.yaml`, or `None` if it was never written.
    ///
    /// # Errors
    /// Fails when the file exists but can't be read or parsed.
    pub fn load(path: &Path) -> Result<Option<Self>> {
        match std::fs::read_to_string(path) {
            Ok(text) => Ok(Some(yaml_serde::from_str::<ColimaFile>(&text)?.into())),
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(err) => Err(err.into()),
        }
    }

    /// Writes the profile's `colima.yaml`.
    ///
    /// # Errors
    /// Fails when the folder or file can't be written.
    pub fn save(&self, path: &Path, profile: Profile) -> Result<()> {
        write(path, &ColimaFile::new(self, profile))
    }

    /// Writes the machines profile's `colima.yaml` with these resources. Full VMs inside Incus need
    /// nested virtualization, which Apple Virtualization offers only on M3 or newer.
    ///
    /// # Errors
    /// Fails when the folder or file can't be written.
    pub fn save_machines(&self, path: &Path, nested_virtualization: bool) -> Result<()> {
        let mut file = ColimaFile::new(self, Profile::Machines);
        file.nested_virtualization = nested_virtualization && self.vm_type == VmType::Vz;
        write(path, &file)
    }

    /// Renders the settings in Colima's own config format.
    ///
    /// # Errors
    /// Only fails if the YAML encoder does.
    pub fn to_colima_yaml(&self, profile: Profile) -> Result<String> {
        Ok(yaml_serde::to_string(&ColimaFile::new(self, profile))?)
    }
}

fn write(path: &Path, file: &ColimaFile) -> Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    std::fs::write(path, yaml_serde::to_string(file)?)?;
    Ok(())
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[expect(clippy::struct_excessive_bools, reason = "mirrors Colima's config format")]
struct ColimaFile {
    cpu: u16,
    memory: u16,
    disk: u16,
    vm_type: String,
    rosetta: bool,
    binfmt: bool,
    #[serde(default)]
    nested_virtualization: bool,
    runtime: String,
    auto_activate: bool,
    hostname: String,
    mount_type: String,
    mount_inotify: bool,
    forward_agent: bool,
    port_forwarder: String,
    network: Network,
    kubernetes: ColimaKubernetes,
    #[serde(default)]
    docker: BTreeMap<String, serde_json::Value>,
}

#[derive(Debug, Serialize, Deserialize)]
struct Network {
    address: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ColimaKubernetes {
    enabled: bool,
    version: String,
    k3s_args: Vec<String>,
}

impl ColimaFile {
    fn new(config: &EngineConfig, profile: Profile) -> Self {
        let is_vz = config.vm_type == VmType::Vz;
        Self {
            cpu: config.cpus,
            memory: config.memory_gib,
            disk: config.disk_gib,
            vm_type: config.vm_type.colima_name().to_owned(),
            rosetta: is_vz && config.rosetta,
            binfmt: !(is_vz && config.rosetta),
            nested_virtualization: false,
            runtime: profile.runtime().to_owned(),
            auto_activate: config.set_docker_context && profile == Profile::Containers,
            hostname: profile.name().to_owned(),
            mount_type: "virtiofs".to_owned(),
            mount_inotify: config.file_watch_events,
            forward_agent: config.forward_ssh_agent,
            port_forwarder: if config.udp_ports { "grpc" } else { "ssh" }.to_owned(),
            network: Network { address: config.container_ip_access },
            kubernetes: ColimaKubernetes {
                enabled: config.kubernetes.enabled && profile == Profile::Containers,
                version: config.kubernetes.version.clone(),
                k3s_args: vec!["--disable=traefik".to_owned()],
            },
            docker: BTreeMap::new(),
        }
    }
}

impl From<ColimaFile> for EngineConfig {
    fn from(file: ColimaFile) -> Self {
        let vm_type = if file.vm_type == "krunkit" { VmType::Krunkit } else { VmType::Vz };
        Self {
            cpus: file.cpu,
            memory_gib: file.memory,
            disk_gib: file.disk,
            vm_type,
            rosetta: file.rosetta,
            kubernetes: Kubernetes {
                enabled: file.kubernetes.enabled,
                version: file.kubernetes.version,
            },
            file_watch_events: file.mount_inotify,
            forward_ssh_agent: file.forward_agent,
            udp_ports: file.port_forwarder == "grpc",
            container_ip_access: file.network.address,
            set_docker_context: file.auto_activate,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_through_colima_yaml() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("containeria/colima.yaml");
        let config = EngineConfig {
            cpus: 6,
            memory_gib: 12,
            udp_ports: true,
            kubernetes: Kubernetes { enabled: true, ..Kubernetes::default() },
            ..EngineConfig::default()
        };
        config.save(&path, Profile::Containers).unwrap();
        assert_eq!(EngineConfig::load(&path).unwrap(), Some(config));
    }

    #[test]
    fn krunkit_falls_back_to_qemu_for_intel_images() {
        let config = EngineConfig { vm_type: VmType::Krunkit, ..EngineConfig::default() };
        let yaml = config.to_colima_yaml(Profile::Containers).unwrap();
        assert!(yaml.contains("rosetta: false"));
        assert!(yaml.contains("binfmt: true"));
    }

    #[test]
    fn machines_profile_never_runs_kubernetes_or_takes_the_docker_context() {
        let config = EngineConfig {
            kubernetes: Kubernetes { enabled: true, ..Kubernetes::default() },
            ..EngineConfig::default()
        };
        let yaml = config.to_colima_yaml(Profile::Machines).unwrap();
        assert!(yaml.contains("runtime: incus"));
        assert!(yaml.contains("autoActivate: false"));
        assert!(yaml.contains("enabled: false"));
    }

    #[test]
    fn machines_get_nested_virtualization_only_on_apple_virtualization() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("containeria-machines/colima.yaml");
        EngineConfig::default().save_machines(&path, true).unwrap();
        let yaml = std::fs::read_to_string(&path).unwrap();
        assert!(yaml.contains("nestedVirtualization: true"));
        assert!(yaml.contains("runtime: incus"));
        let krunkit = EngineConfig { vm_type: VmType::Krunkit, ..EngineConfig::default() };
        krunkit.save_machines(&path, true).unwrap();
        assert!(std::fs::read_to_string(&path).unwrap().contains("nestedVirtualization: false"));
    }

    #[test]
    fn missing_file_means_never_configured() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(EngineConfig::load(&dir.path().join("colima.yaml")).unwrap(), None);
    }
}
