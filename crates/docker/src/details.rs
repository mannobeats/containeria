use std::collections::BTreeMap;

use bollard::models::{
    ContainerInspectResponse, HealthStatusEnum, MountPoint, PortBinding, RestartPolicyNameEnum,
};
use bollard::query_parameters::InspectContainerOptions;
use serde::{Deserialize, Serialize};

use crate::containers::{COMPOSE_PROJECT, COMPOSE_SERVICE, ContainerState, Port, PortProtocol};
use crate::{Docker, Result};

/// Docker reports this for a container that never started or never finished.
const NEVER: &str = "0001-01-01T00:00:00Z";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct EnvVar {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum MountKind {
    Volume,
    Bind,
    Tmpfs,
    Other,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Mount {
    pub kind: MountKind,
    /// The volume name for volumes, the Mac or VM path for binds.
    pub source: String,
    pub destination: String,
    pub read_only: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum HealthStatus {
    Starting,
    Healthy,
    Unhealthy,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct HealthCheck {
    pub started_at: String,
    pub exit_code: i32,
    pub output: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Health {
    pub status: HealthStatus,
    pub failing_streak: u32,
    /// The most recent checks, oldest first.
    pub checks: Vec<HealthCheck>,
}

/// Everything the detail page shows about one container.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ContainerDetails {
    pub id: String,
    pub name: String,
    pub image: String,
    pub image_id: String,
    pub command: String,
    pub state: ContainerState,
    pub created_at: String,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub exit_code: i32,
    pub error: Option<String>,
    pub restart_count: u32,
    pub restart_policy: String,
    pub platform: String,
    pub ip_address: Option<String>,
    pub networks: Vec<String>,
    pub project: Option<String>,
    pub service: Option<String>,
    pub ports: Vec<Port>,
    pub mounts: Vec<Mount>,
    pub env: Vec<EnvVar>,
    pub health: Option<Health>,
    /// `docker inspect` output, pretty-printed, for the Inspect tab.
    pub raw: String,
}

fn non_empty(value: Option<String>) -> Option<String> {
    value.filter(|value| !value.is_empty() && value != NEVER)
}

fn to_i32(value: Option<i64>) -> i32 {
    value.and_then(|value| i32::try_from(value).ok()).unwrap_or(0)
}

fn to_u32(value: Option<i64>) -> u32 {
    value.and_then(|value| u32::try_from(value).ok()).unwrap_or(0)
}

fn env_var(entry: String) -> EnvVar {
    match entry.split_once('=') {
        Some((key, value)) => EnvVar { key: key.to_owned(), value: value.to_owned() },
        None => EnvVar { key: entry, value: String::new() },
    }
}

fn mount(raw: MountPoint) -> Mount {
    let kind = match raw.typ.as_deref() {
        Some("volume") => MountKind::Volume,
        Some("bind") => MountKind::Bind,
        Some("tmpfs") => MountKind::Tmpfs,
        _ => MountKind::Other,
    };
    let source = match kind {
        MountKind::Volume => raw.name.or(raw.source),
        _ => raw.source,
    };
    Mount {
        kind,
        source: source.unwrap_or_default(),
        destination: raw.destination.unwrap_or_default(),
        read_only: raw.rw == Some(false),
    }
}

/// `"5432/tcp": [{HostPort: "5433"}]` becomes one `Port` per distinct host port.
fn ports(map: BTreeMap<String, Option<Vec<PortBinding>>>) -> Vec<Port> {
    let mut ports: Vec<Port> = map
        .into_iter()
        .flat_map(|(key, bindings)| {
            let (number, protocol) = key.split_once('/').unwrap_or((&key, "tcp"));
            let container = number.parse().unwrap_or(0);
            let protocol = match protocol {
                "udp" => PortProtocol::Udp,
                "sctp" => PortProtocol::Sctp,
                _ => PortProtocol::Tcp,
            };
            let hosts: Vec<Option<u16>> = match bindings {
                Some(bindings) if !bindings.is_empty() => bindings
                    .into_iter()
                    .map(|binding| binding.host_port.and_then(|port| port.parse().ok()))
                    .collect(),
                _ => vec![None],
            };
            hosts.into_iter().map(move |host| Port { container, host, protocol })
        })
        .collect();
    ports.sort_by_key(|port| (port.container, port.protocol, port.host));
    ports.dedup();
    ports
}

fn restart_policy(name: Option<RestartPolicyNameEnum>, retries: Option<i64>) -> String {
    match name {
        Some(RestartPolicyNameEnum::ALWAYS) => "always".to_owned(),
        Some(RestartPolicyNameEnum::UNLESS_STOPPED) => "unless-stopped".to_owned(),
        Some(RestartPolicyNameEnum::ON_FAILURE) => match retries.filter(|count| *count > 0) {
            Some(count) => format!("on-failure, max {count}"),
            None => "on-failure".to_owned(),
        },
        _ => "no".to_owned(),
    }
}

fn health(raw: Option<bollard::models::Health>) -> Option<Health> {
    let raw = raw?;
    let status = match raw.status? {
        HealthStatusEnum::STARTING => HealthStatus::Starting,
        HealthStatusEnum::HEALTHY => HealthStatus::Healthy,
        HealthStatusEnum::UNHEALTHY => HealthStatus::Unhealthy,
        HealthStatusEnum::NONE | HealthStatusEnum::EMPTY => return None,
    };
    let checks = raw
        .log
        .unwrap_or_default()
        .into_iter()
        .map(|check| HealthCheck {
            started_at: check.start.unwrap_or_default(),
            exit_code: to_i32(check.exit_code),
            output: check.output.unwrap_or_default().trim().to_owned(),
        })
        .collect();
    Some(Health { status, failing_streak: to_u32(raw.failing_streak), checks })
}

impl ContainerDetails {
    fn from_raw(raw: ContainerInspectResponse, pretty: String) -> Self {
        let state = raw.state.unwrap_or_default();
        let config = raw.config.unwrap_or_default();
        let host = raw.host_config.unwrap_or_default();
        let mut labels = config.labels.unwrap_or_default();
        let networks =
            raw.network_settings.and_then(|settings| settings.networks).unwrap_or_default();
        let mut network_names: Vec<String> = networks.keys().cloned().collect();
        network_names.sort();
        let ip_address = networks.into_values().find_map(|endpoint| non_empty(endpoint.ip_address));
        let command = raw.path.into_iter().chain(raw.args.unwrap_or_default()).collect::<Vec<_>>();
        let policy = host.restart_policy.unwrap_or_default();
        let running = state.running == Some(true);
        Self {
            id: raw.id.unwrap_or_default(),
            name: raw.name.unwrap_or_default().trim_start_matches('/').to_owned(),
            image: config.image.unwrap_or_default(),
            image_id: raw.image.unwrap_or_default(),
            command: command.join(" "),
            state: crate::containers::state_from_inspect(state.status),
            created_at: raw.created.unwrap_or_default(),
            started_at: non_empty(state.started_at),
            finished_at: if running { None } else { non_empty(state.finished_at) },
            exit_code: to_i32(state.exit_code),
            error: non_empty(state.error),
            restart_count: to_u32(raw.restart_count),
            restart_policy: restart_policy(policy.name, policy.maximum_retry_count),
            platform: raw.platform.unwrap_or_else(|| "linux".to_owned()),
            ip_address,
            networks: network_names,
            project: labels.remove(COMPOSE_PROJECT),
            service: labels.remove(COMPOSE_SERVICE),
            ports: ports(host.port_bindings.unwrap_or_default().into_iter().collect()),
            mounts: raw.mounts.unwrap_or_default().into_iter().map(mount).collect(),
            env: config.env.unwrap_or_default().into_iter().map(env_var).collect(),
            health: health(state.health),
            raw: pretty,
        }
    }
}

impl Docker {
    /// The detail page's view of one container, with the raw `docker inspect` JSON.
    ///
    /// # Errors
    /// Fails when the container doesn't exist or the engine can't be reached.
    pub async fn details(&self, id: &str) -> Result<ContainerDetails> {
        let raw = self.api.inspect_container(id, None::<InspectContainerOptions>).await?;
        let pretty = serde_json::to_string_pretty(&raw).unwrap_or_default();
        Ok(ContainerDetails::from_raw(raw, pretty))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const INSPECT: &str = r#"{
        "Id": "abc123", "Created": "2026-10-17T08:00:00.000000000Z", "Path": "docker-entrypoint.sh",
        "Args": ["postgres"], "Name": "/shop-db-1", "RestartCount": 2, "Image": "sha256:1",
        "State": {"Status": "running", "Running": true, "ExitCode": 0, "Error": "",
          "StartedAt": "2026-10-17T08:00:01Z", "FinishedAt": "0001-01-01T00:00:00Z",
          "Health": {"Status": "unhealthy", "FailingStreak": 3,
            "Log": [{"Start": "2026-10-17T08:01:00Z", "ExitCode": 1, "Output": "no response\n"}]}},
        "Config": {"Image": "postgres:18", "Env": ["POSTGRES_PASSWORD=secret", "EMPTY"],
          "Labels": {"com.docker.compose.project": "shop", "com.docker.compose.service": "db"}},
        "HostConfig": {"RestartPolicy": {"Name": "on-failure", "MaximumRetryCount": 5},
          "PortBindings": {"5432/tcp": [{"HostIp": "", "HostPort": "5433"}], "9000/udp": null}},
        "Mounts": [{"Type": "volume", "Name": "shop_pg", "Source": "/var/lib/docker/volumes/shop_pg/_data",
          "Destination": "/var/lib/postgresql/data", "RW": true},
          {"Type": "bind", "Source": "/Users/ada/shop", "Destination": "/app", "RW": false}],
        "NetworkSettings": {"Networks": {"shop_default": {"IPAddress": "172.20.0.3"}}}
    }"#;

    fn details() -> ContainerDetails {
        let raw: ContainerInspectResponse = serde_json::from_str(INSPECT).unwrap();
        ContainerDetails::from_raw(raw, String::new())
    }

    #[test]
    fn reads_identity_command_and_compose_labels() {
        let details = details();
        assert_eq!(details.name, "shop-db-1");
        assert_eq!(details.command, "docker-entrypoint.sh postgres");
        assert_eq!(details.project.as_deref(), Some("shop"));
        assert_eq!(details.service.as_deref(), Some("db"));
        assert_eq!(details.ip_address.as_deref(), Some("172.20.0.3"));
        assert_eq!(details.state, ContainerState::Running);
    }

    #[test]
    fn hides_the_zero_dates_docker_uses_for_never() {
        let details = details();
        assert_eq!(details.started_at.as_deref(), Some("2026-10-17T08:00:01Z"));
        assert_eq!(details.finished_at, None);
        assert_eq!(details.error, None);
    }

    #[test]
    fn reads_env_ports_mounts_and_restart_policy() {
        let details = details();
        assert_eq!(
            details.env[0],
            EnvVar { key: "POSTGRES_PASSWORD".into(), value: "secret".into() }
        );
        assert_eq!(details.env[1].value, "");
        assert_eq!(
            details.ports,
            vec![
                Port { container: 5432, host: Some(5433), protocol: PortProtocol::Tcp },
                Port { container: 9000, host: None, protocol: PortProtocol::Udp },
            ]
        );
        assert_eq!(details.mounts[0].source, "shop_pg");
        assert_eq!(details.mounts[0].kind, MountKind::Volume);
        assert!(details.mounts[1].read_only);
        assert_eq!(details.restart_policy, "on-failure, max 5");
        assert_eq!(details.restart_count, 2);
    }

    #[test]
    fn reads_the_health_log() {
        let health = details().health.unwrap();
        assert_eq!(health.status, HealthStatus::Unhealthy);
        assert_eq!(health.failing_streak, 3);
        assert_eq!(health.checks[0].output, "no response");
    }
}
