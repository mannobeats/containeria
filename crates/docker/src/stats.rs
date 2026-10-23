use bollard::models::{ContainerCpuStats, ContainerStatsResponse};
use bollard::query_parameters::StatsOptionsBuilder;
use futures::{Stream, StreamExt};
use serde::Serialize;

use crate::{Docker, Result};

/// One stats reading, already turned into the numbers the UI draws.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct StatsSample {
    pub cpu_percent: f64,
    #[specta(type = specta_typescript::Number)]
    pub memory_bytes: u64,
    #[specta(type = specta_typescript::Number)]
    pub memory_limit_bytes: u64,
    #[specta(type = specta_typescript::Number)]
    pub network_rx_bytes: u64,
    #[specta(type = specta_typescript::Number)]
    pub network_tx_bytes: u64,
    #[specta(type = specta_typescript::Number)]
    pub disk_read_bytes: u64,
    #[specta(type = specta_typescript::Number)]
    pub disk_write_bytes: u64,
}

impl From<&ContainerStatsResponse> for StatsSample {
    fn from(raw: &ContainerStatsResponse) -> Self {
        let (received, sent) = raw.networks.iter().flatten().fold((0, 0), |(rx, tx), (_, net)| {
            (rx + net.rx_bytes.unwrap_or(0), tx + net.tx_bytes.unwrap_or(0))
        });
        let (read, written) = raw
            .blkio_stats
            .as_ref()
            .and_then(|blkio| blkio.io_service_bytes_recursive.as_ref())
            .into_iter()
            .flatten()
            .fold((0, 0), |(read, write), entry| {
                let value = entry.value.unwrap_or(0);
                match entry.op.as_deref().map(str::to_ascii_lowercase).as_deref() {
                    Some("read") => (read + value, write),
                    Some("write") => (read, write + value),
                    _ => (read, write),
                }
            });
        let memory = raw.memory_stats.as_ref();
        Self {
            cpu_percent: cpu_percent(raw),
            memory_bytes: memory_in_use(raw),
            memory_limit_bytes: memory.and_then(|memory| memory.limit).unwrap_or(0),
            network_rx_bytes: received,
            network_tx_bytes: sent,
            disk_read_bytes: read,
            disk_write_bytes: written,
        }
    }
}

/// Cumulative CPU time counters. Two readings give a CPU percentage, the same way `docker stats`
/// works it out.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CpuCounters {
    container: u64,
    system: u64,
    cpus: u32,
}

impl CpuCounters {
    fn read(stats: Option<&ContainerCpuStats>) -> Option<Self> {
        let stats = stats?;
        Some(Self {
            container: stats.cpu_usage.as_ref()?.total_usage?,
            system: stats.system_cpu_usage?,
            cpus: stats.online_cpus.unwrap_or(1),
        })
    }

    /// The container's share of all CPUs since `earlier`, where 100 is one full core.
    #[must_use]
    #[expect(clippy::cast_precision_loss, reason = "CPU nanoseconds fit comfortably in an f64")]
    pub fn percent_since(self, earlier: Self) -> f64 {
        let system = self.system.saturating_sub(earlier.system) as f64;
        if system <= 0.0 {
            return 0.0;
        }
        let container = self.container.saturating_sub(earlier.container) as f64;
        container / system * f64::from(self.cpus) * 100.0
    }
}

fn cpu_percent(raw: &ContainerStatsResponse) -> f64 {
    match (CpuCounters::read(raw.cpu_stats.as_ref()), CpuCounters::read(raw.precpu_stats.as_ref()))
    {
        (Some(now), Some(before)) => now.percent_since(before),
        _ => 0.0,
    }
}

/// A quick reading without waiting for Docker's one-second CPU sample.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Usage {
    pub memory_bytes: u64,
    pub cpu: Option<CpuCounters>,
}

/// Same as `docker stats`: page cache the kernel can drop doesn't count as used.
fn memory_in_use(raw: &ContainerStatsResponse) -> u64 {
    let Some(memory) = raw.memory_stats.as_ref() else { return 0 };
    let usage = memory.usage.unwrap_or(0);
    let cache = memory.stats.as_ref().and_then(|stats| stats.get("inactive_file")).copied();
    usage.saturating_sub(cache.unwrap_or(0))
}

impl Docker {
    /// One reading, returned at once. CPU needs a second reading to mean anything.
    ///
    /// # Errors
    /// Fails when the container is gone or the engine can't be reached.
    pub async fn usage(&self, id: &str) -> Result<Usage> {
        let options = StatsOptionsBuilder::new().stream(false).one_shot(true).build();
        let mut readings = std::pin::pin!(self.api.stats(id, Some(options)));
        let raw = readings.next().await.ok_or_else(|| crate::Error::NotFound(id.to_owned()))??;
        Ok(Usage {
            memory_bytes: memory_in_use(&raw),
            cpu: CpuCounters::read(raw.cpu_stats.as_ref()),
        })
    }

    /// A reading about once a second until the container stops or the stream is dropped.
    pub fn stats(&self, id: &str) -> impl Stream<Item = Result<StatsSample>> + use<> {
        let options = StatsOptionsBuilder::new().stream(true).one_shot(false).build();
        self.api
            .stats(id, Some(options))
            .map(|reading| reading.map(|raw| StatsSample::from(&raw)).map_err(Into::into))
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use bollard::models::{
        ContainerBlkioStatEntry, ContainerBlkioStats, ContainerCpuStats, ContainerCpuUsage,
        ContainerMemoryStats, ContainerNetworkStats,
    };

    use super::*;

    fn cpu(total: u64, system: u64) -> ContainerCpuStats {
        ContainerCpuStats {
            cpu_usage: Some(ContainerCpuUsage { total_usage: Some(total), ..Default::default() }),
            system_cpu_usage: Some(system),
            online_cpus: Some(4),
            throttling_data: None,
        }
    }

    #[test]
    fn computes_cpu_memory_network_and_disk() {
        let raw = ContainerStatsResponse {
            cpu_stats: Some(cpu(1_500, 20_000)),
            precpu_stats: Some(cpu(1_000, 10_000)),
            memory_stats: Some(ContainerMemoryStats {
                usage: Some(300),
                limit: Some(1_000),
                stats: Some(HashMap::from([("inactive_file".to_owned(), 100)])),
                ..Default::default()
            }),
            networks: Some(HashMap::from([
                (
                    "eth0".to_owned(),
                    ContainerNetworkStats {
                        rx_bytes: Some(10),
                        tx_bytes: Some(5),
                        ..Default::default()
                    },
                ),
                (
                    "eth1".to_owned(),
                    ContainerNetworkStats {
                        rx_bytes: Some(1),
                        tx_bytes: Some(1),
                        ..Default::default()
                    },
                ),
            ])),
            blkio_stats: Some(ContainerBlkioStats {
                io_service_bytes_recursive: Some(vec![
                    ContainerBlkioStatEntry {
                        op: Some("read".into()),
                        value: Some(7),
                        ..Default::default()
                    },
                    ContainerBlkioStatEntry {
                        op: Some("Write".into()),
                        value: Some(9),
                        ..Default::default()
                    },
                ]),
                ..Default::default()
            }),
            ..Default::default()
        };
        let sample = StatsSample::from(&raw);
        assert!((sample.cpu_percent - 20.0).abs() < f64::EPSILON);
        assert_eq!(sample.memory_bytes, 200);
        assert_eq!(sample.memory_limit_bytes, 1_000);
        assert_eq!((sample.network_rx_bytes, sample.network_tx_bytes), (11, 6));
        assert_eq!((sample.disk_read_bytes, sample.disk_write_bytes), (7, 9));
    }

    #[test]
    fn first_reading_has_no_cpu_delta() {
        let raw =
            ContainerStatsResponse { cpu_stats: Some(cpu(1_000, 10_000)), ..Default::default() };
        assert!(StatsSample::from(&raw).cpu_percent.abs() < f64::EPSILON);
    }
}
