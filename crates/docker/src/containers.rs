use std::cmp::Reverse;
use std::collections::HashMap;

use bollard::models::{
    ContainerSummary as RawSummary, ContainerSummaryStateEnum, PortSummaryTypeEnum,
};
use bollard::query_parameters::{
    KillContainerOptions, ListContainersOptionsBuilder, RemoveContainerOptionsBuilder,
    RestartContainerOptions, StartContainerOptions, StopContainerOptions,
};
use serde::{Deserialize, Serialize};

use crate::{Docker, Result};

pub(crate) const COMPOSE_PROJECT: &str = "com.docker.compose.project";
pub(crate) const COMPOSE_SERVICE: &str = "com.docker.compose.service";
const POD_NAMESPACE: &str = "io.kubernetes.pod.namespace";
const POD_NAME: &str = "io.kubernetes.pod.name";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum ContainerState {
    Created,
    Running,
    Paused,
    Restarting,
    Exited,
    Removing,
    Dead,
}

impl From<Option<ContainerSummaryStateEnum>> for ContainerState {
    fn from(state: Option<ContainerSummaryStateEnum>) -> Self {
        use ContainerSummaryStateEnum as Raw;
        match state {
            Some(Raw::RUNNING) => Self::Running,
            Some(Raw::PAUSED) => Self::Paused,
            Some(Raw::RESTARTING) => Self::Restarting,
            Some(Raw::REMOVING) => Self::Removing,
            Some(Raw::DEAD) => Self::Dead,
            Some(Raw::CREATED) => Self::Created,
            Some(Raw::EXITED | Raw::STOPPING | Raw::EMPTY) | None => Self::Exited,
        }
    }
}

/// The same mapping for `docker inspect`, which uses its own enum.
pub(crate) fn state_from_inspect(
    state: Option<bollard::models::ContainerStateStatusEnum>,
) -> ContainerState {
    use bollard::models::ContainerStateStatusEnum as Raw;
    match state {
        Some(Raw::RUNNING) => ContainerState::Running,
        Some(Raw::PAUSED) => ContainerState::Paused,
        Some(Raw::RESTARTING) => ContainerState::Restarting,
        Some(Raw::REMOVING) => ContainerState::Removing,
        Some(Raw::DEAD) => ContainerState::Dead,
        Some(Raw::CREATED) => ContainerState::Created,
        Some(Raw::EXITED | Raw::STOPPING | Raw::EMPTY) | None => ContainerState::Exited,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum PortProtocol {
    Tcp,
    Udp,
    Sctp,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Port {
    pub container: u16,
    pub host: Option<u16>,
    pub protocol: PortProtocol,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ContainerSummary {
    pub id: String,
    pub name: String,
    pub image: String,
    pub state: ContainerState,
    pub status: String,
    pub project: Option<String>,
    pub service: Option<String>,
    /// `namespace/name` when Kubernetes runs this container for a pod.
    pub pod: Option<String>,
    pub ports: Vec<Port>,
    #[specta(type = specta_typescript::Number)]
    pub created_at: i64,
}

impl From<RawSummary> for ContainerSummary {
    fn from(raw: RawSummary) -> Self {
        let mut labels = raw.labels.unwrap_or_default();
        let name = raw
            .names
            .and_then(|names| names.into_iter().next())
            .map(|name| name.trim_start_matches('/').to_owned())
            .unwrap_or_default();
        Self {
            id: raw.id.unwrap_or_default(),
            name,
            image: raw.image.unwrap_or_default(),
            state: raw.state.into(),
            status: raw.status.unwrap_or_default(),
            project: labels.remove(COMPOSE_PROJECT),
            service: labels.remove(COMPOSE_SERVICE),
            pod: labels
                .remove(POD_NAMESPACE)
                .zip(labels.remove(POD_NAME))
                .map(|(namespace, name)| format!("{namespace}/{name}")),
            ports: dedupe_ports(raw.ports.unwrap_or_default()),
            created_at: raw.created.unwrap_or_default(),
        }
    }
}

/// Docker lists a published port once per host address (0.0.0.0 and ::). Show it once.
fn dedupe_ports(raw: Vec<bollard::models::PortSummary>) -> Vec<Port> {
    let mut ports: Vec<Port> = raw
        .into_iter()
        .map(|port| Port {
            container: port.private_port,
            host: port.public_port,
            protocol: match port.typ {
                Some(PortSummaryTypeEnum::UDP) => PortProtocol::Udp,
                Some(PortSummaryTypeEnum::SCTP) => PortProtocol::Sctp,
                _ => PortProtocol::Tcp,
            },
        })
        .collect();
    ports.sort_by_key(|port| (port.container, port.host));
    ports.dedup();
    ports
}

/// What the user can do to a container from the list.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum ContainerAction {
    Start,
    Stop,
    Restart,
    Pause,
    Resume,
    Kill,
    Remove,
}

impl Docker {
    /// Every container, running or not, newest first.
    ///
    /// # Errors
    /// Fails when the engine can't be reached.
    pub async fn containers(&self) -> Result<Vec<ContainerSummary>> {
        let options = ListContainersOptionsBuilder::new().all(true).build();
        let raw = self.api.list_containers(Some(options)).await?;
        let mut containers: Vec<ContainerSummary> = raw.into_iter().map(Into::into).collect();
        containers.sort_by_key(|container| Reverse(container.created_at));
        Ok(containers)
    }

    /// Every container in one Compose project.
    ///
    /// # Errors
    /// Fails when the engine can't be reached.
    pub async fn project_containers(&self, project: &str) -> Result<Vec<ContainerSummary>> {
        let filters = HashMap::from([("label", vec![format!("{COMPOSE_PROJECT}={project}")])]);
        let options = ListContainersOptionsBuilder::new().all(true).filters(&filters).build();
        let raw = self.api.list_containers(Some(options)).await?;
        Ok(raw.into_iter().map(Into::into).collect())
    }

    /// # Errors
    /// Fails when the container doesn't exist or the engine refuses.
    pub async fn act(&self, id: &str, action: ContainerAction) -> Result<()> {
        match action {
            ContainerAction::Start => {
                self.api.start_container(id, None::<StartContainerOptions>).await?;
            }
            ContainerAction::Stop => {
                self.api.stop_container(id, None::<StopContainerOptions>).await?;
            }
            ContainerAction::Restart => {
                self.api.restart_container(id, None::<RestartContainerOptions>).await?;
            }
            ContainerAction::Pause => self.api.pause_container(id).await?,
            ContainerAction::Resume => self.api.unpause_container(id).await?,
            ContainerAction::Kill => {
                self.api.kill_container(id, None::<KillContainerOptions>).await?;
            }
            ContainerAction::Remove => {
                let options = RemoveContainerOptionsBuilder::new().force(true).v(false).build();
                self.api.remove_container(id, Some(options)).await?;
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use bollard::models::PortSummary;

    use super::*;

    fn port(private: u16, public: Option<u16>, ip: &str) -> PortSummary {
        PortSummary {
            ip: Some(ip.to_owned()),
            private_port: private,
            public_port: public,
            typ: Some(PortSummaryTypeEnum::TCP),
        }
    }

    #[test]
    fn reads_compose_labels_and_trims_the_name() {
        let raw = RawSummary {
            id: Some("abc".into()),
            names: Some(vec!["/shop-db-1".into()]),
            state: Some(ContainerSummaryStateEnum::RUNNING),
            labels: Some(HashMap::from([
                (COMPOSE_PROJECT.to_owned(), "shop".to_owned()),
                (COMPOSE_SERVICE.to_owned(), "db".to_owned()),
            ])),
            ..RawSummary::default()
        };
        let summary = ContainerSummary::from(raw);
        assert_eq!(summary.name, "shop-db-1");
        assert_eq!(summary.project.as_deref(), Some("shop"));
        assert_eq!(summary.service.as_deref(), Some("db"));
        assert_eq!(summary.state, ContainerState::Running);
        assert_eq!(summary.pod, None);
    }

    #[test]
    fn marks_containers_kubernetes_runs_for_a_pod() {
        let raw = RawSummary {
            labels: Some(HashMap::from([
                (POD_NAMESPACE.to_owned(), "shop".to_owned()),
                (POD_NAME.to_owned(), "api-7d9f".to_owned()),
            ])),
            ..RawSummary::default()
        };
        assert_eq!(ContainerSummary::from(raw).pod.as_deref(), Some("shop/api-7d9f"));
    }

    #[test]
    fn shows_a_port_published_on_ipv4_and_ipv6_once() {
        let ports = dedupe_ports(vec![
            port(5432, Some(5432), "0.0.0.0"),
            port(5432, Some(5432), "::"),
            port(80, None, ""),
        ]);
        assert_eq!(
            ports,
            vec![
                Port { container: 80, host: None, protocol: PortProtocol::Tcp },
                Port { container: 5432, host: Some(5432), protocol: PortProtocol::Tcp },
            ]
        );
    }

    #[test]
    fn a_stopping_container_reads_as_exited() {
        assert_eq!(
            ContainerState::from(Some(ContainerSummaryStateEnum::STOPPING)),
            ContainerState::Exited
        );
    }
}
