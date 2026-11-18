use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::error::Result;

const GIB: u64 = 1 << 30;

/// The k3s release a new engine runs: the latest stable one when this was written.
pub const K3S_DEFAULT_VERSION: &str = "v1.37.2+k3s1";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Kubernetes {
    pub enabled: bool,
    /// An exact k3s release. The engine fetches it the first time it runs it.
    pub version: String,
}

impl Default for Kubernetes {
    fn default() -> Self {
        Self { enabled: false, version: K3S_DEFAULT_VERSION.to_owned() }
    }
}

/// The settings people change. Saved as JSON and read by the engine each time its VM starts.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct EngineConfig {
    pub cpus: u16,
    /// The most memory the VM may use. It takes what its containers need, not this much.
    pub memory_gib: u16,
    /// The most disk the VM may use. The file on the Mac holds only what is stored.
    pub disk_gib: u16,
    /// Run Intel images through Rosetta.
    pub rosetta: bool,
    /// Turn the VM off while nothing runs in it; the next `docker` command turns it back on.
    pub sleep_when_idle: bool,
    /// How long nothing must run, and nobody talk to Docker, before the VM turns off.
    pub idle_seconds: u32,
    pub kubernetes: Kubernetes,
    pub set_docker_context: bool,
    /// Pull-through mirrors for Docker Hub, tried in order.
    pub registry_mirrors: Vec<String>,
    /// Registries Docker may reach over plain HTTP, such as a local `registry:2`.
    pub insecure_registries: Vec<String>,
}

impl Default for EngineConfig {
    fn default() -> Self {
        Self::for_host(
            std::thread::available_parallelism().map_or(4, std::num::NonZero::get),
            crate::host::memory_bytes().unwrap_or(16 * GIB),
        )
    }
}

impl EngineConfig {
    /// The defaults on a Mac with this many cores and this much memory: every core, since an idle
    /// one costs nothing, and half the memory up to 8 GiB as the ceiling.
    fn for_host(cores: usize, memory_bytes: u64) -> Self {
        Self {
            cpus: u16::try_from(cores).unwrap_or(4).max(1),
            memory_gib: u16::try_from((memory_bytes / GIB / 2).clamp(2, 8)).unwrap_or(8),
            disk_gib: 100,
            rosetta: true,
            sleep_when_idle: true,
            idle_seconds: 60,
            kubernetes: Kubernetes::default(),
            set_docker_context: true,
            registry_mirrors: Vec::new(),
            insecure_registries: Vec::new(),
        }
    }

    /// Reads the saved settings, or `None` if none were ever saved. A setting the file doesn't
    /// have, as one added since it was written, takes its default.
    ///
    /// # Errors
    /// Fails when the file exists but can't be read or parsed.
    pub fn load(path: &Path) -> Result<Option<Self>> {
        match std::fs::read(path) {
            Ok(text) => {
                let mut settings = serde_json::to_value(Self::default())?;
                overlay(&mut settings, serde_json::from_slice(&text)?);
                Ok(Some(serde_json::from_value(settings)?))
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(error.into()),
        }
    }

    /// # Errors
    /// Fails when the folder or file can't be written.
    pub fn save(&self, path: &Path) -> Result<()> {
        if let Some(folder) = path.parent() {
            std::fs::create_dir_all(folder)?;
        }
        Ok(std::fs::write(path, serde_json::to_vec_pretty(self)?)?)
    }

    #[must_use]
    pub fn memory_bytes(&self) -> u64 {
        u64::from(self.memory_gib) * GIB
    }

    #[must_use]
    pub fn disk_bytes(&self) -> u64 {
        u64::from(self.disk_gib) * GIB
    }

    /// The part of Docker's `daemon.json` these settings decide.
    #[must_use]
    pub fn docker_settings(&self) -> serde_json::Value {
        let mut settings = serde_json::Map::new();
        if !self.registry_mirrors.is_empty() {
            settings.insert("registry-mirrors".to_owned(), self.registry_mirrors.clone().into());
        }
        if !self.insecure_registries.is_empty() {
            settings
                .insert("insecure-registries".to_owned(), self.insecure_registries.clone().into());
        }
        settings.into()
    }
}

/// Puts `saved` over `settings`, group by group, so what `saved` lacks keeps its value.
fn overlay(settings: &mut serde_json::Value, saved: serde_json::Value) {
    match (settings, saved) {
        (serde_json::Value::Object(settings), serde_json::Value::Object(saved)) => {
            for (key, value) in saved {
                // A key that isn't there is a setting this version no longer has.
                if let Some(setting) = settings.get_mut(&key) {
                    overlay(setting, value);
                }
            }
        }
        (setting, saved) => *setting = saved,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_through_its_file() {
        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().join("home/engine.json");
        let config = EngineConfig {
            cpus: 6,
            memory_gib: 12,
            registry_mirrors: vec!["https://mirror.gcr.io".into()],
            ..EngineConfig::for_host(10, 32 * GIB)
        };
        config.save(&path).unwrap();
        assert_eq!(EngineConfig::load(&path).unwrap(), Some(config));
    }

    #[test]
    fn a_missing_file_means_never_configured() {
        let folder = tempfile::tempdir().unwrap();
        assert_eq!(EngineConfig::load(&folder.path().join("engine.json")).unwrap(), None);
    }

    #[test]
    fn a_setting_added_later_takes_its_default() {
        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().join("engine.json");
        std::fs::write(&path, r#"{"cpus": 2, "kubernetes": {"enabled": true}}"#).unwrap();
        let config = EngineConfig::load(&path).unwrap().unwrap();
        assert_eq!(config.cpus, 2);
        assert!(config.sleep_when_idle);
        assert!(config.kubernetes.enabled);
        assert_eq!(config.kubernetes.version, K3S_DEFAULT_VERSION);
    }

    #[test]
    fn a_setting_this_version_dropped_is_ignored() {
        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().join("engine.json");
        std::fs::write(&path, r#"{"vmType": "krunkit", "cpus": 3}"#).unwrap();
        assert_eq!(EngineConfig::load(&path).unwrap().unwrap().cpus, 3);
    }

    #[test]
    fn the_memory_ceiling_is_half_the_mac_between_two_and_eight_gib() {
        assert_eq!(EngineConfig::for_host(8, 8 * GIB).memory_gib, 4);
        assert_eq!(EngineConfig::for_host(8, 2 * GIB).memory_gib, 2);
        assert_eq!(EngineConfig::for_host(16, 64 * GIB).memory_gib, 8);
    }

    #[test]
    fn docker_gets_only_the_registries_that_were_set() {
        assert_eq!(EngineConfig::for_host(4, 8 * GIB).docker_settings(), serde_json::json!({}));
        let config = EngineConfig {
            registry_mirrors: vec!["https://mirror.gcr.io".into()],
            insecure_registries: vec!["localhost:5000".into()],
            ..EngineConfig::for_host(4, 8 * GIB)
        };
        assert_eq!(
            config.docker_settings(),
            serde_json::json!({
                "registry-mirrors": ["https://mirror.gcr.io"],
                "insecure-registries": ["localhost:5000"],
            })
        );
    }
}
