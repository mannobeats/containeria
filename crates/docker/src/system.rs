use bollard::models::SystemInfo;
use serde::Serialize;

use crate::{Docker, Result};

/// What the engine says about itself.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct EngineInfo {
    pub server_version: String,
    pub kernel_version: String,
    pub operating_system: String,
    pub cpus: u32,
    #[specta(type = specta_typescript::Number)]
    pub memory_bytes: u64,
}

impl From<SystemInfo> for EngineInfo {
    fn from(info: SystemInfo) -> Self {
        Self {
            server_version: info.server_version.unwrap_or_default(),
            kernel_version: info.kernel_version.unwrap_or_default(),
            operating_system: info.operating_system.unwrap_or_default(),
            cpus: info.ncpu.and_then(|cpus| u32::try_from(cpus).ok()).unwrap_or(0),
            memory_bytes: info.mem_total.and_then(|bytes| u64::try_from(bytes).ok()).unwrap_or(0),
        }
    }
}

impl Docker {
    /// The engine's version, kernel and the memory and CPUs it can see.
    ///
    /// # Errors
    /// Fails when the engine can't be reached.
    pub async fn info(&self) -> Result<EngineInfo> {
        Ok(self.api.info().await?.into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_parts_of_docker_info_the_app_shows() {
        let info = EngineInfo::from(SystemInfo {
            server_version: Some("29.1.0".into()),
            kernel_version: Some("6.8.0-60-generic".into()),
            operating_system: Some("Ubuntu 24.04.3 LTS".into()),
            ncpu: Some(4),
            mem_total: Some(8_331_210_752),
            ..SystemInfo::default()
        });
        assert_eq!(info.server_version, "29.1.0");
        assert_eq!(info.cpus, 4);
        assert_eq!(info.memory_bytes, 8_331_210_752);
    }

    #[test]
    fn missing_fields_read_as_empty() {
        let info = EngineInfo::from(SystemInfo { ncpu: Some(-1), ..SystemInfo::default() });
        assert_eq!(info.cpus, 0);
        assert_eq!(info.memory_bytes, 0);
    }
}
