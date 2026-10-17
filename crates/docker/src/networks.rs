use std::collections::HashMap;

use bollard::models::{
    Ipam, IpamConfig, NetworkConnectRequest, NetworkCreateRequest, NetworkDisconnectRequest,
};
use bollard::query_parameters::{
    InspectNetworkOptions, ListContainersOptionsBuilder, ListNetworksOptions,
};
use serde::{Deserialize, Serialize};

use crate::{Docker, Result};

const COMPOSE_PROJECT: &str = "com.docker.compose.project";
const BUILT_IN: [&str; 3] = ["bridge", "host", "none"];

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct NetworkSummary {
    pub id: String,
    pub name: String,
    pub driver: String,
    pub scope: String,
    pub subnet: Option<String>,
    pub gateway: Option<String>,
    pub internal: bool,
    pub ipv6: bool,
    /// `bridge`, `host` and `none` come with Docker and can't be deleted.
    pub built_in: bool,
    /// The Compose project that created it, from its labels.
    pub project: Option<String>,
    /// Names of the containers attached to it.
    pub containers: Vec<String>,
}

fn summarize(
    raw: bollard::models::Network,
    attached: &mut HashMap<String, Vec<String>>,
) -> NetworkSummary {
    let name = raw.name.unwrap_or_default();
    let ipam = raw
        .ipam
        .and_then(|ipam| ipam.config)
        .and_then(|config| config.into_iter().next())
        .unwrap_or_default();
    let labels = raw.labels.unwrap_or_default();
    NetworkSummary {
        id: raw.id.unwrap_or_default(),
        driver: raw.driver.unwrap_or_default(),
        scope: raw.scope.unwrap_or_default(),
        subnet: ipam.subnet,
        gateway: ipam.gateway,
        internal: raw.internal.unwrap_or(false),
        ipv6: raw.enable_ipv6.unwrap_or(false),
        built_in: BUILT_IN.contains(&name.as_str()),
        project: labels.get(COMPOSE_PROJECT).cloned(),
        containers: attached.remove(&name).unwrap_or_default(),
        name,
    }
}

/// A container's address on one network.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct NetworkEndpoint {
    pub container_id: String,
    pub container: String,
    pub ipv4: Option<String>,
    pub mac: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct NetworkDetail {
    pub network: NetworkSummary,
    pub endpoints: Vec<NetworkEndpoint>,
}

fn endpoints(
    raw: Option<HashMap<String, bollard::models::EndpointResource>>,
) -> Vec<NetworkEndpoint> {
    let mut endpoints: Vec<NetworkEndpoint> = raw
        .unwrap_or_default()
        .into_iter()
        .map(|(id, endpoint)| NetworkEndpoint {
            container_id: id,
            container: endpoint.name.unwrap_or_default(),
            ipv4: endpoint.ipv4_address.filter(|address| !address.is_empty()),
            mac: endpoint.mac_address.filter(|address| !address.is_empty()),
        })
        .collect();
    endpoints.sort_by(|a, b| a.container.cmp(&b.container));
    endpoints
}

/// What the new-network sheet asks for.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct NetworkSpec {
    pub name: String,
    pub driver: String,
    pub subnet: Option<String>,
    pub gateway: Option<String>,
    pub internal: bool,
    pub ipv6: bool,
}

impl From<NetworkSpec> for NetworkCreateRequest {
    fn from(spec: NetworkSpec) -> Self {
        let ipam = spec.subnet.is_some().then(|| Ipam {
            config: Some(vec![IpamConfig {
                subnet: spec.subnet,
                gateway: spec.gateway,
                ..Default::default()
            }]),
            ..Default::default()
        });
        Self {
            name: spec.name,
            driver: Some(spec.driver),
            internal: Some(spec.internal),
            enable_ipv6: Some(spec.ipv6),
            ipam,
            ..Default::default()
        }
    }
}

impl Docker {
    /// Every network: project networks by name, then the built-in ones.
    ///
    /// # Errors
    /// Fails when the engine can't be reached.
    pub async fn networks(&self) -> Result<Vec<NetworkSummary>> {
        let raw = self.api.list_networks(None::<ListNetworksOptions>).await?;
        let mut attached = self.attached_containers().await?;
        let mut networks: Vec<NetworkSummary> =
            raw.into_iter().map(|network| summarize(network, &mut attached)).collect();
        networks.sort_by(|a, b| (a.built_in, &a.name).cmp(&(b.built_in, &b.name)));
        Ok(networks)
    }

    async fn attached_containers(&self) -> Result<HashMap<String, Vec<String>>> {
        let options = ListContainersOptionsBuilder::new().all(true).build();
        let mut attached: HashMap<String, Vec<String>> = HashMap::new();
        for container in self.api.list_containers(Some(options)).await? {
            let name = container.names.unwrap_or_default().into_iter().next().unwrap_or_default();
            let networks = container
                .network_settings
                .and_then(|settings| settings.networks)
                .unwrap_or_default();
            for network in networks.into_keys() {
                attached.entry(network).or_default().push(name.trim_start_matches('/').to_owned());
            }
        }
        Ok(attached)
    }

    /// # Errors
    /// Fails when the network doesn't exist.
    pub async fn network(&self, id: &str) -> Result<NetworkDetail> {
        let raw = self.api.inspect_network(id, None::<InspectNetworkOptions>).await?;
        let endpoints = endpoints(raw.containers.clone());
        let network = bollard::models::Network {
            name: raw.name,
            id: raw.id,
            scope: raw.scope,
            driver: raw.driver,
            enable_ipv6: raw.enable_ipv6,
            ipam: raw.ipam,
            internal: raw.internal,
            labels: raw.labels,
            ..Default::default()
        };
        let mut attached = HashMap::new();
        let mut network = summarize(network, &mut attached);
        network.containers = endpoints.iter().map(|endpoint| endpoint.container.clone()).collect();
        Ok(NetworkDetail { network, endpoints })
    }

    /// # Errors
    /// Fails when the name is taken or the subnet overlaps another network.
    pub async fn create_network(&self, spec: NetworkSpec) -> Result<()> {
        self.api.create_network(spec.into()).await?;
        Ok(())
    }

    /// # Errors
    /// Fails for built-in networks and networks containers still use.
    pub async fn remove_network(&self, id: &str) -> Result<()> {
        Ok(self.api.remove_network(id).await?)
    }

    /// # Errors
    /// Fails when either doesn't exist or the container is already attached.
    pub async fn connect_network(&self, network: &str, container: &str) -> Result<()> {
        let request =
            NetworkConnectRequest { container: container.to_owned(), endpoint_config: None };
        Ok(self.api.connect_network(network, request).await?)
    }

    /// # Errors
    /// Fails when the container isn't attached.
    pub async fn disconnect_network(&self, network: &str, container: &str) -> Result<()> {
        let request =
            NetworkDisconnectRequest { container: container.to_owned(), force: Some(false) };
        Ok(self.api.disconnect_network(network, request).await?)
    }
}

#[cfg(test)]
mod tests {
    use bollard::models::EndpointResource;

    use super::*;

    fn network(
        name: &str,
        subnet: Option<&str>,
        labels: &[(&str, &str)],
    ) -> bollard::models::Network {
        bollard::models::Network {
            name: Some(name.into()),
            driver: Some("bridge".into()),
            ipam: Some(Ipam {
                config: Some(vec![IpamConfig {
                    subnet: subnet.map(Into::into),
                    gateway: Some("172.18.0.1".into()),
                    ..Default::default()
                }]),
                ..Default::default()
            }),
            labels: Some(
                labels
                    .iter()
                    .map(|(key, value)| ((*key).to_owned(), (*value).to_owned()))
                    .collect(),
            ),
            ..Default::default()
        }
    }

    #[test]
    fn reads_subnet_project_and_attached_containers() {
        let raw = network("shop_default", Some("172.18.0.0/16"), &[(COMPOSE_PROJECT, "shop")]);
        let mut attached =
            HashMap::from([("shop_default".to_owned(), vec!["shop-db-1".to_owned()])]);
        let summary = summarize(raw, &mut attached);
        assert_eq!(summary.subnet.as_deref(), Some("172.18.0.0/16"));
        assert_eq!(summary.project.as_deref(), Some("shop"));
        assert_eq!(summary.containers, ["shop-db-1"]);
        assert!(!summary.built_in);
    }

    #[test]
    fn marks_docker_built_in_networks() {
        assert!(summarize(network("bridge", None, &[]), &mut HashMap::new()).built_in);
    }

    #[test]
    fn lists_endpoints_by_container_name_without_empty_addresses() {
        let raw = HashMap::from([
            (
                "b".to_owned(),
                EndpointResource {
                    name: Some("web".into()),
                    ipv4_address: Some("172.18.0.3/16".into()),
                    mac_address: Some(String::new()),
                    ..Default::default()
                },
            ),
            ("a".to_owned(), EndpointResource { name: Some("api".into()), ..Default::default() }),
        ]);
        let endpoints = endpoints(Some(raw));
        assert_eq!(endpoints[0].container, "api");
        assert_eq!(endpoints[1].ipv4.as_deref(), Some("172.18.0.3/16"));
        assert_eq!(endpoints[1].mac, None);
    }

    #[test]
    fn only_asks_for_ipam_when_a_subnet_is_given() {
        let spec = NetworkSpec {
            name: "pay".into(),
            driver: "bridge".into(),
            subnet: None,
            gateway: None,
            internal: true,
            ipv6: false,
        };
        let request = NetworkCreateRequest::from(spec);
        assert!(request.ipam.is_none());
        assert_eq!(request.internal, Some(true));
    }
}
