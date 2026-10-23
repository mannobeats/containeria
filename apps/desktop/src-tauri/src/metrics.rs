use std::collections::{HashMap, VecDeque};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use containeria_docker::{ContainerState, ContainerSummary, CpuCounters, Docker};
use futures::{StreamExt, stream};
use serde::Serialize;
use tauri::{AppHandle, Manager};
use tauri_specta::Event;
use tokio::sync::RwLock;

use crate::engine::Engine;
use crate::events::MetricsUpdated;
use crate::notifications::{self, Alerts};
use crate::tray;

const GIB: u64 = 1024 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ContainerUsage {
    pub(crate) id: String,
    /// `None` on the first reading: CPU needs two.
    pub(crate) cpu_percent: Option<f64>,
    #[specta(type = specta_typescript::Number)]
    pub(crate) memory_bytes: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) enum SegmentKind {
    Project,
    Standalone,
    Kubernetes,
}

/// One coloured stretch of the memory ledger.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LedgerSegment {
    pub(crate) id: String,
    pub(crate) label: String,
    pub(crate) kind: SegmentKind,
    #[specta(type = specta_typescript::Number)]
    pub(crate) bytes: u64,
}

/// Where the engine's memory goes, by Compose project.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Ledger {
    #[specta(type = specta_typescript::Number)]
    pub(crate) total_bytes: u64,
    #[specta(type = specta_typescript::Number)]
    pub(crate) used_bytes: u64,
    pub(crate) segments: Vec<LedgerSegment>,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Metrics {
    pub(crate) sampled_at_ms: f64,
    pub(crate) containers: Vec<ContainerUsage>,
    pub(crate) ledger: Ledger,
}

/// One point of the Activity charts: totals and the ledger at one moment.
#[derive(Debug, Clone, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MetricsPoint {
    pub(crate) sampled_at_ms: f64,
    /// Summed over containers, where 100 is one full core.
    pub(crate) cpu_percent: f64,
    #[specta(type = specta_typescript::Number)]
    pub(crate) used_bytes: u64,
    pub(crate) segments: Vec<LedgerSegment>,
}

impl From<&Metrics> for MetricsPoint {
    fn from(metrics: &Metrics) -> Self {
        Self {
            sampled_at_ms: metrics.sampled_at_ms,
            cpu_percent: metrics.containers.iter().filter_map(|usage| usage.cpu_percent).sum(),
            used_bytes: metrics.ledger.used_bytes,
            segments: metrics.ledger.segments.clone(),
        }
    }
}

/// Samples every running container's CPU and memory, for the list, the ledger and the menu bar,
/// and keeps the last half hour for Activity.
#[derive(Debug, Default)]
pub(crate) struct Sampler {
    latest: RwLock<Option<Metrics>>,
    history: RwLock<VecDeque<MetricsPoint>>,
}

impl Sampler {
    const EVERY: Duration = Duration::from_secs(2);
    /// While the window is hidden only the menu bar's memory reading needs it, so the engine
    /// isn't woken every two seconds.
    const EVERY_HIDDEN: Duration = Duration::from_secs(10);
    const PARALLEL_READINGS: usize = 8;
    /// Thirty minutes at one sample every two seconds.
    const HISTORY: usize = 900;

    pub(crate) async fn latest(&self) -> Option<Metrics> {
        self.latest.read().await.clone()
    }

    pub(crate) async fn history(&self) -> Vec<MetricsPoint> {
        self.history.read().await.iter().cloned().collect()
    }

    async fn record(&self, metrics: &Metrics) {
        let mut history = self.history.write().await;
        if history.len() == Self::HISTORY {
            history.pop_front();
        }
        history.push_back(metrics.into());
    }

    pub(crate) async fn run(&self, engine: Arc<Engine>, app: AppHandle) {
        let mut previous = HashMap::new();
        let mut alerts = Alerts::default();
        loop {
            let metrics = match engine.docker().await {
                Ok(docker) => sample(&docker, &engine, &mut previous).await,
                Err(_) => None,
            };
            if let Some(metrics) = &metrics {
                self.record(metrics).await;
                if let Some(alert) = alerts.on_sample(&metrics.ledger, Instant::now()) {
                    notifications::send(&app, &alert);
                }
                let _ = MetricsUpdated(metrics.clone()).emit(&app);
            }
            tray::show_memory(&app, metrics.as_ref().map(|metrics| metrics.ledger.used_bytes));
            *self.latest.write().await = metrics;
            let shown = app
                .get_webview_window("main")
                .is_some_and(|window| window.is_visible().unwrap_or(true));
            tokio::time::sleep(if shown { Self::EVERY } else { Self::EVERY_HIDDEN }).await;
        }
    }
}

async fn sample(
    docker: &Docker,
    engine: &Engine,
    previous: &mut HashMap<String, CpuCounters>,
) -> Option<Metrics> {
    let running: Vec<ContainerSummary> = docker
        .containers()
        .await
        .ok()?
        .into_iter()
        .filter(|container| container.state == ContainerState::Running)
        .collect();
    let ids: Vec<String> = running.iter().map(|container| container.id.clone()).collect();
    let readings: Vec<_> = stream::iter(ids)
        .map(|id| async move {
            let reading = docker.usage(&id).await;
            (id, reading)
        })
        .buffer_unordered(Sampler::PARALLEL_READINGS)
        .collect()
        .await;

    let mut usage = Vec::with_capacity(readings.len());
    let mut next = HashMap::with_capacity(readings.len());
    for (id, reading) in readings {
        let Ok(reading) = reading else { continue };
        let cpu_percent = reading
            .cpu
            .zip(previous.get(&id).copied())
            .map(|(now, before)| now.percent_since(before));
        if let Some(cpu) = reading.cpu {
            next.insert(id.clone(), cpu);
        }
        usage.push(ContainerUsage { id, cpu_percent, memory_bytes: reading.memory_bytes });
    }
    *previous = next;

    let total_bytes = if engine.is_external() {
        docker.info().await.map_or(0, |info| info.memory_bytes)
    } else {
        engine.config().map_or(0, |config| u64::from(config.memory_gib) * GIB)
    };
    let ledger = ledger(&running, &usage, total_bytes);
    Some(Metrics { sampled_at_ms: now_ms(), containers: usage, ledger })
}

/// Groups memory by Compose project, then standalone containers, then Kubernetes, biggest first.
fn ledger(running: &[ContainerSummary], usage: &[ContainerUsage], total_bytes: u64) -> Ledger {
    let memory: HashMap<&str, u64> =
        usage.iter().map(|usage| (usage.id.as_str(), usage.memory_bytes)).collect();
    let mut segments: Vec<LedgerSegment> = Vec::new();
    for container in running {
        let bytes = memory.get(container.id.as_str()).copied().unwrap_or(0);
        let (id, label, kind) = match (&container.pod, &container.project) {
            (Some(_), _) => {
                ("kubernetes".to_owned(), "Kubernetes".to_owned(), SegmentKind::Kubernetes)
            }
            (None, Some(project)) => {
                (format!("project:{project}"), project.clone(), SegmentKind::Project)
            }
            (None, None) => {
                ("standalone".to_owned(), "Standalone".to_owned(), SegmentKind::Standalone)
            }
        };
        match segments.iter_mut().find(|segment| segment.id == id) {
            Some(segment) => segment.bytes += bytes,
            None => segments.push(LedgerSegment { id, label, kind, bytes }),
        }
    }
    segments.sort_by_key(|segment| {
        (segment.kind != SegmentKind::Project, std::cmp::Reverse(segment.bytes))
    });
    let used_bytes = segments.iter().map(|segment| segment.bytes).sum();
    Ledger { total_bytes, used_bytes, segments }
}

#[expect(
    clippy::cast_precision_loss,
    reason = "milliseconds since 1970 fit in an f64 for millennia"
)]
fn now_ms() -> f64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0.0, |elapsed| elapsed.as_millis() as f64)
}

#[cfg(test)]
mod tests {
    use containeria_docker::ContainerState;

    use super::*;

    fn container(id: &str, project: Option<&str>, pod: Option<&str>) -> ContainerSummary {
        ContainerSummary {
            id: id.to_owned(),
            name: id.to_owned(),
            image: "busybox".to_owned(),
            state: ContainerState::Running,
            status: "Up".to_owned(),
            project: project.map(str::to_owned),
            service: None,
            pod: pod.map(str::to_owned),
            ports: Vec::new(),
            created_at: 0,
        }
    }

    fn usage(id: &str, memory_bytes: u64) -> ContainerUsage {
        ContainerUsage { id: id.to_owned(), cpu_percent: None, memory_bytes }
    }

    #[test]
    fn groups_by_project_and_puts_projects_first() {
        let running = [
            container("a", Some("shop"), None),
            container("b", Some("shop"), None),
            container("c", None, None),
            container("d", Some("blog"), None),
            container("e", None, Some("default/web")),
        ];
        let usage =
            [usage("a", 100), usage("b", 50), usage("c", 500), usage("d", 200), usage("e", 70)];
        let ledger = ledger(&running, &usage, 1000);
        let order: Vec<_> = ledger.segments.iter().map(|s| (s.id.as_str(), s.bytes)).collect();
        assert_eq!(
            order,
            [("project:blog", 200), ("project:shop", 150), ("standalone", 500), ("kubernetes", 70)]
        );
        assert_eq!(ledger.used_bytes, 920);
        assert_eq!(ledger.total_bytes, 1000);
    }

    #[test]
    fn a_point_sums_cpu_and_keeps_the_ledger() {
        let metrics = Metrics {
            sampled_at_ms: 1.0,
            containers: vec![
                ContainerUsage { id: "a".into(), cpu_percent: Some(12.5), memory_bytes: 10 },
                ContainerUsage { id: "b".into(), cpu_percent: None, memory_bytes: 20 },
                ContainerUsage { id: "c".into(), cpu_percent: Some(2.5), memory_bytes: 30 },
            ],
            ledger: ledger(&[container("a", Some("shop"), None)], &[usage("a", 10)], 100),
        };
        let point = MetricsPoint::from(&metrics);
        assert!((point.cpu_percent - 15.0).abs() < f64::EPSILON);
        assert_eq!(point.used_bytes, 10);
        assert_eq!(point.segments.len(), 1);
    }

    #[tokio::test]
    async fn keeps_only_the_last_half_hour() {
        let sampler = Sampler::default();
        let metrics =
            Metrics { sampled_at_ms: 0.0, containers: Vec::new(), ledger: ledger(&[], &[], 0) };
        for _ in 0..Sampler::HISTORY + 5 {
            sampler.record(&metrics).await;
        }
        assert_eq!(sampler.history().await.len(), Sampler::HISTORY);
    }

    #[test]
    fn a_container_without_a_reading_counts_as_zero() {
        let ledger = ledger(&[container("a", Some("shop"), None)], &[], 1000);
        assert_eq!(ledger.used_bytes, 0);
        assert_eq!(ledger.segments.len(), 1);
    }
}
