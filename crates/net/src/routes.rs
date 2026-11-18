use std::net::SocketAddr;

use contena_docker::{ContainerState, ContainerSummary, PortProtocol};
use serde::{Deserialize, Serialize};

use crate::host::{container_host, is_within, normalize};

/// A name the user added, like `shop.test`, pointing at one port of one container.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CustomRoute {
    pub host: String,
    pub container: String,
    pub port: u16,
    pub https: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum RouteKind {
    Container,
    Custom,
    /// A Kubernetes service reachable from the Mac.
    Service,
}

/// A Kubernetes service the Mac reaches on `mac_port` of 127.0.0.1.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClusterService {
    pub namespace: String,
    pub name: String,
    pub port: u16,
    pub mac_port: u16,
}

/// `web` in `shop` → `web.shop.k8s.contena.local`.
fn service_route(service: &ClusterService, tld: &str, https: bool) -> Option<DomainRoute> {
    let host = normalize(&format!("{}.{}.k8s.{tld}", service.name, service.namespace))?;
    Some(DomainRoute {
        host,
        kind: RouteKind::Service,
        container: format!("{}/{}", service.namespace, service.name),
        port: Some(service.port),
        upstream: Some(Upstream::Published(service.mac_port)),
        https,
        down: None,
    })
}

/// Why a route can't be reached right now.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum RouteDown {
    /// The container is stopped or gone.
    Stopped,
    /// The container runs but has no port to send requests to: it neither publishes nor
    /// exposes one.
    NoPort,
}

/// Where the proxy sends a route's requests.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Upstream {
    /// A port published on the Mac, on 127.0.0.1.
    Published(u16),
    /// The container's own address and port, inside the engine.
    Inside(SocketAddr),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct DomainRoute {
    pub host: String,
    pub kind: RouteKind,
    pub container: String,
    /// The port inside the container.
    pub port: Option<u16>,
    #[serde(skip)]
    pub upstream: Option<Upstream>,
    pub https: bool,
    pub down: Option<RouteDown>,
}

/// Every name Contena answers for, and where each one goes.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct RouteTable {
    tld: String,
    routes: Vec<DomainRoute>,
}

/// Web servers usually listen on one of these; prefer them when a container has several ports.
const WEB_PORTS: [u16; 7] = [80, 8080, 3000, 8000, 5173, 4000, 443];

/// Where `port` of `container` is reached: on the Mac when the container publishes it, else at
/// the container's own address, which needs no port published.
fn upstream(container: &ContainerSummary, port: u16) -> Option<Upstream> {
    let published = container
        .ports
        .iter()
        .find(|candidate| candidate.container == port && candidate.protocol == PortProtocol::Tcp)
        .and_then(|candidate| candidate.host);
    match published {
        Some(published) => Some(Upstream::Published(published)),
        None => container.address.map(|address| Upstream::Inside(SocketAddr::new(address, port))),
    }
}

/// The port a container most likely serves the web on: one it publishes before one its image
/// only exposes, since publishing is the user's own word, and a usual web port before others.
fn web_port(container: &ContainerSummary) -> Option<u16> {
    container
        .ports
        .iter()
        .filter(|port| port.protocol == PortProtocol::Tcp)
        .min_by_key(|port| {
            let usual = WEB_PORTS.iter().position(|&web| web == port.container);
            (port.host.is_none(), usual.unwrap_or(usize::MAX), port.container)
        })
        .map(|port| port.container)
}

fn running(container: &ContainerSummary) -> bool {
    container.state == ContainerState::Running
}

fn container_route(container: &ContainerSummary, tld: &str, https: bool) -> Option<DomainRoute> {
    let host = container_host(
        &container.name,
        container.project.as_deref(),
        container.service.as_deref(),
        tld,
    )?;
    let port = web_port(container);
    let upstream = port.and_then(|port| upstream(container, port));
    let down = match (running(container), upstream) {
        (false, _) => Some(RouteDown::Stopped),
        (true, None) => Some(RouteDown::NoPort),
        (true, Some(_)) => None,
    };
    Some(DomainRoute {
        host,
        kind: RouteKind::Container,
        container: container.name.clone(),
        port,
        upstream,
        https,
        down,
    })
}

fn custom_route(custom: &CustomRoute, containers: &[ContainerSummary]) -> DomainRoute {
    let target = containers.iter().find(|container| container.name == custom.container);
    let upstream = target.and_then(|container| upstream(container, custom.port));
    let down = match target {
        Some(container) if running(container) && upstream.is_some() => None,
        Some(container) if running(container) => Some(RouteDown::NoPort),
        _ => Some(RouteDown::Stopped),
    };
    DomainRoute {
        host: custom.host.clone(),
        kind: RouteKind::Custom,
        container: custom.container.clone(),
        port: Some(custom.port),
        upstream,
        https: custom.https,
        down,
    }
}

impl RouteTable {
    /// Routes for every container (Kubernetes pods excluded) and Kubernetes service reachable from
    /// the Mac, plus the user's own, custom ones first.
    #[must_use]
    pub(crate) fn build(
        tld: &str,
        containers: &[ContainerSummary],
        services: &[ClusterService],
        custom: &[CustomRoute],
        https: bool,
    ) -> Self {
        let mut routes: Vec<DomainRoute> =
            custom.iter().map(|route| custom_route(route, containers)).collect();
        routes.extend(
            containers
                .iter()
                .filter(|container| container.pod.is_none())
                .filter_map(|container| container_route(container, tld, https)),
        );
        routes.extend(services.iter().filter_map(|service| service_route(service, tld, https)));
        Self { tld: tld.to_owned(), routes }
    }

    #[must_use]
    pub(crate) fn routes(&self) -> &[DomainRoute] {
        &self.routes
    }

    /// Whether DNS should answer for `name`: anything under the top-level domain, or a custom route.
    #[must_use]
    pub(crate) fn resolves(&self, name: &str) -> bool {
        normalize(name).is_some_and(|name| {
            is_within(&name, &self.tld)
                || self
                    .routes
                    .iter()
                    .any(|route| route.kind == RouteKind::Custom && is_within(&name, &route.host))
        })
    }

    /// The route for a request's host: an exact match, else the closest parent, so
    /// `assets.web.shop.contena.local` reaches `web.shop.contena.local`.
    #[must_use]
    pub(crate) fn find(&self, host: &str) -> Option<&DomainRoute> {
        let host = normalize(host)?;
        self.routes
            .iter()
            .filter(|route| is_within(&host, &route.host))
            .max_by_key(|route| route.host.len())
    }
}

#[cfg(test)]
mod tests {
    use contena_docker::Port;

    use super::*;

    fn container(name: &str, project: Option<&str>, ports: &[(u16, u16)]) -> ContainerSummary {
        ContainerSummary {
            id: name.to_owned(),
            name: name.to_owned(),
            image: "nginx".to_owned(),
            state: ContainerState::Running,
            status: "Up".to_owned(),
            project: project.map(str::to_owned),
            service: project
                .map(|_| name.trim_start_matches("shop-").trim_end_matches("-1").to_owned()),
            pod: None,
            ports: ports
                .iter()
                .map(|&(inside, outside)| Port {
                    container: inside,
                    host: Some(outside),
                    protocol: PortProtocol::Tcp,
                })
                .collect(),
            address: None,
            created_at: 0,
        }
    }

    /// A container that publishes nothing: its image exposes `ports`, and it has an address.
    fn unpublished(name: &str, ports: &[u16]) -> ContainerSummary {
        let mut container = container(name, None, &[]);
        container.ports = ports
            .iter()
            .map(|&inside| Port { container: inside, host: None, protocol: PortProtocol::Tcp })
            .collect();
        container.address = Some("172.17.0.5".parse().unwrap());
        container
    }

    fn table() -> RouteTable {
        let containers = [
            container("shop-web-1", Some("shop"), &[(9229, 9229), (3000, 3001)]),
            container("redis", None, &[]),
            container("shop-api-1", Some("shop"), &[(8080, 18080)]),
        ];
        let custom = [CustomRoute {
            host: "shop.test".into(),
            container: "shop-api-1".into(),
            port: 8080,
            https: true,
        }];
        RouteTable::build("contena.local", &containers, &[], &custom, true)
    }

    #[test]
    fn names_kubernetes_services_by_namespace() {
        let service = ClusterService {
            namespace: "shop".into(),
            name: "web".into(),
            port: 80,
            mac_port: 30080,
        };
        let table = RouteTable::build("contena.local", &[], &[service], &[], true);
        let route = &table.routes()[0];
        assert_eq!(route.host, "web.shop.k8s.contena.local");
        assert_eq!(route.kind, RouteKind::Service);
        assert_eq!(route.upstream, Some(Upstream::Published(30080)));
        assert!(table.resolves("web.shop.k8s.contena.local"));
    }

    #[test]
    fn routes_a_compose_service_to_its_web_port() {
        let table = table();
        let route = table.find("web.shop.contena.local").unwrap();
        assert_eq!(
            (route.port, route.upstream, route.down),
            (Some(3000), Some(Upstream::Published(3001)), None)
        );
    }

    #[test]
    fn subdomains_reach_the_closest_route() {
        let table = table();
        assert_eq!(table.find("assets.web.shop.contena.local").unwrap().container, "shop-web-1");
        assert_eq!(
            table.find("v2.shop.test:443").unwrap().upstream,
            Some(Upstream::Published(18080))
        );
    }

    #[test]
    fn a_container_with_no_port_at_all_is_down_not_missing() {
        let table = table();
        assert_eq!(table.find("redis.contena.local").unwrap().down, Some(RouteDown::NoPort));
    }

    #[test]
    fn a_container_that_publishes_nothing_is_reached_at_its_own_address() {
        let containers = [unpublished("web", &[9000, 80])];
        let table = RouteTable::build("contena.local", &containers, &[], &[], true);
        let route = table.find("web.contena.local").unwrap();
        let inside = Upstream::Inside("172.17.0.5:80".parse().unwrap());
        assert_eq!((route.port, route.upstream, route.down), (Some(80), Some(inside), None));
    }

    #[test]
    fn a_published_port_is_preferred_to_one_the_image_only_exposes() {
        let mut web = unpublished("web", &[80]);
        web.ports.push(Port { container: 9000, host: Some(19000), protocol: PortProtocol::Tcp });
        let table = RouteTable::build("contena.local", &[web], &[], &[], true);
        let route = table.find("web.contena.local").unwrap();
        assert_eq!(route.upstream, Some(Upstream::Published(19000)));
    }

    #[test]
    fn a_custom_route_reaches_a_port_the_container_neither_publishes_nor_exposes() {
        let custom = [CustomRoute {
            host: "admin.test".into(),
            container: "web".into(),
            port: 9100,
            https: false,
        }];
        let table =
            RouteTable::build("contena.local", &[unpublished("web", &[])], &[], &custom, true);
        let route = table.find("admin.test").unwrap();
        assert_eq!(route.upstream, Some(Upstream::Inside("172.17.0.5:9100".parse().unwrap())));
        assert_eq!(route.down, None);
    }

    #[test]
    fn a_custom_route_to_a_stopped_container_is_down() {
        let mut stopped = container("blog", None, &[(80, 8081)]);
        stopped.state = ContainerState::Exited;
        let custom = [CustomRoute {
            host: "blog.test".into(),
            container: "blog".into(),
            port: 80,
            https: false,
        }];
        let table = RouteTable::build("contena.local", &[stopped], &[], &custom, true);
        assert_eq!(table.find("blog.test").unwrap().down, Some(RouteDown::Stopped));
    }

    #[test]
    fn resolves_the_zone_and_custom_routes_only() {
        let table = table();
        assert!(table.resolves("anything.contena.local"));
        assert!(table.resolves("api.shop.test."));
        assert!(!table.resolves("example.com"));
        assert!(!table.resolves("myshop.test"));
    }
}
