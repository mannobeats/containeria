use bollard::models::SystemInfo;
use bollard::query_parameters::{PruneBuildOptions, PruneContainersOptions};
use serde::Serialize;

use crate::{Docker, PruneReport, Result};

/// One kind of thing taking space in the engine.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct UsageGroup {
    pub count: u32,
    /// How many are used by a container, or for the build cache, in use by a build.
    pub active: u32,
    #[specta(type = specta_typescript::Number)]
    pub size_bytes: u64,
    /// What a clean-up would free.
    #[specta(type = specta_typescript::Number)]
    pub reclaimable_bytes: u64,
}

/// Where the engine's disk space goes, as `docker system df` reports it.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct DiskUsage {
    pub images: UsageGroup,
    pub containers: UsageGroup,
    pub volumes: UsageGroup,
    pub build_cache: UsageGroup,
}

fn group(
    total: Option<i64>,
    active: Option<i64>,
    size: Option<i64>,
    reclaimable: Option<i64>,
) -> UsageGroup {
    let count = |value: Option<i64>| value.and_then(|value| u32::try_from(value).ok()).unwrap_or(0);
    let bytes = |value: Option<i64>| value.and_then(|value| u64::try_from(value).ok()).unwrap_or(0);
    UsageGroup {
        count: count(total),
        active: count(active),
        size_bytes: bytes(size),
        reclaimable_bytes: bytes(reclaimable),
    }
}

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

    /// # Errors
    /// Fails when the engine can't be reached.
    pub async fn disk_usage(&self) -> Result<DiskUsage> {
        let usage = self.api.df(None).await?;
        let mut disk = DiskUsage::default();
        if let Some(images) = usage.image_usage {
            disk.images = group(
                images.total_count,
                images.active_count,
                images.total_size,
                images.reclaimable,
            );
        }
        if let Some(containers) = usage.container_usage {
            disk.containers = group(
                containers.total_count,
                containers.active_count,
                containers.total_size,
                containers.reclaimable,
            );
        }
        if let Some(volumes) = usage.volume_usage {
            disk.volumes = group(
                volumes.total_count,
                volumes.active_count,
                volumes.total_size,
                volumes.reclaimable,
            );
        }
        if let Some(cache) = usage.build_cache_usage {
            disk.build_cache =
                group(cache.total_count, cache.active_count, cache.total_size, cache.reclaimable);
        }
        Ok(disk)
    }

    /// Deletes every stopped container.
    ///
    /// # Errors
    /// Fails when the engine refuses.
    pub async fn prune_containers(&self) -> Result<PruneReport> {
        let response = self.api.prune_containers(None::<PruneContainersOptions>).await?;
        Ok(PruneReport::new(
            response.containers_deleted.map_or(0, |deleted| deleted.len()),
            response.space_reclaimed,
        ))
    }

    /// Deletes the build cache no build is using.
    ///
    /// # Errors
    /// Fails when the engine refuses.
    pub async fn prune_build_cache(&self) -> Result<PruneReport> {
        let response = self.api.prune_build(None::<PruneBuildOptions>).await?;
        Ok(PruneReport::new(
            response.caches_deleted.map_or(0, |deleted| deleted.len()),
            response.space_reclaimed,
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_missing_usage_numbers_as_zero() {
        let usage = group(Some(3), None, Some(2048), Some(-1));
        assert_eq!(
            usage,
            UsageGroup { count: 3, active: 0, size_bytes: 2048, reclaimable_bytes: 0 }
        );
    }

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
