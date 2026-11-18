//! What running k3s takes that is plain text and JSON: where a release is fetched from, checking
//! what was fetched, and which ports a service wants on the Mac.

use contena_proto::Transport;
use serde_json::Value;

/// Where the k3s binary and its checksums are published for `version`, such as `v1.37.2+k3s1`.
#[must_use]
pub fn release_urls(version: &str) -> (String, String) {
    let base =
        format!("https://github.com/k3s-io/k3s/releases/download/{}", version.replace('+', "%2B"));
    (format!("{base}/k3s-arm64"), format!("{base}/sha256sum-arm64.txt"))
}

/// The SHA-256 the release's checksum file gives for the k3s binary.
#[must_use]
pub fn published_checksum(sums: &str) -> Option<&str> {
    sums.lines().find_map(|line| {
        let mut words = line.split_whitespace();
        let sum = words.next()?;
        (words.next()?.trim_start_matches('*') == "k3s-arm64").then_some(sum)
    })
}

/// What one event of `kubectl get services --watch --output-watch-events -o json` says.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServiceEvent {
    /// Namespace and name, which a service keeps for its life.
    pub service: String,
    /// The ports the Mac should reach, each also the port in the guest: a load balancer's own
    /// ports and every node port. Empty once the service is deleted.
    pub ports: Vec<(Transport, u16)>,
}

impl ServiceEvent {
    #[must_use]
    pub fn read(event: &Value) -> Option<Self> {
        let object = &event["object"];
        let metadata = &object["metadata"];
        let service = format!("{}/{}", metadata["namespace"].as_str()?, metadata["name"].as_str()?);
        if event["type"] == "DELETED" {
            return Some(Self { service, ports: Vec::new() });
        }
        let balanced = object["spec"]["type"] == "LoadBalancer";
        let mut ports = Vec::new();
        for port in object["spec"]["ports"].as_array().into_iter().flatten() {
            let transport = match port["protocol"].as_str().unwrap_or("TCP") {
                "TCP" => Transport::Tcp,
                "UDP" => Transport::Udp,
                _ => continue,
            };
            let numbers = [port["nodePort"].as_u64(), port["port"].as_u64().filter(|_| balanced)];
            ports.extend(
                numbers
                    .into_iter()
                    .flatten()
                    .filter_map(|n| Some((transport, u16::try_from(n).ok()?))),
            );
        }
        ports.sort_unstable_by_key(|(transport, port)| (*port, *transport == Transport::Udp));
        ports.dedup();
        Some(Self { service, ports })
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn a_release_is_fetched_from_its_escaped_tag() {
        let (binary, sums) = release_urls("v1.37.2+k3s1");
        assert_eq!(
            binary,
            "https://github.com/k3s-io/k3s/releases/download/v1.37.2%2Bk3s1/k3s-arm64"
        );
        assert!(sums.ends_with("/v1.37.2%2Bk3s1/sha256sum-arm64.txt"));
    }

    #[test]
    fn finds_the_binarys_checksum_among_the_releases_files() {
        let sums =
            "aaa111  k3s-airgap-images-arm64.tar\nbbb222  k3s-arm64\nccc333 *k3s-images.txt\n";
        assert_eq!(published_checksum(sums), Some("bbb222"));
        assert_eq!(published_checksum("aaa111  k3s-airgap-images-arm64.tar\n"), None);
    }

    fn service(kind: &str, ports: &Value) -> Value {
        json!({ "type": "ADDED", "object": {
            "metadata": { "namespace": "shop", "name": "web" },
            "spec": { "type": kind, "ports": ports },
        }})
    }

    #[test]
    fn a_load_balancer_wants_its_own_ports_and_its_node_ports() {
        let event = service(
            "LoadBalancer",
            &json!([
                { "port": 80, "nodePort": 31080, "protocol": "TCP" },
                { "port": 53, "nodePort": 31053, "protocol": "UDP" },
            ]),
        );
        let read = ServiceEvent::read(&event).unwrap();
        assert_eq!(read.service, "shop/web");
        assert_eq!(
            read.ports,
            [
                (Transport::Udp, 53),
                (Transport::Tcp, 80),
                (Transport::Udp, 31053),
                (Transport::Tcp, 31080),
            ]
        );
    }

    #[test]
    fn a_node_port_service_wants_only_its_node_ports() {
        let event = service("NodePort", &json!([{ "port": 80, "nodePort": 30080 }]));
        assert_eq!(ServiceEvent::read(&event).unwrap().ports, [(Transport::Tcp, 30080)]);
    }

    #[test]
    fn a_service_inside_the_cluster_wants_nothing() {
        let event = service("ClusterIP", &json!([{ "port": 80, "protocol": "TCP" }]));
        assert!(ServiceEvent::read(&event).unwrap().ports.is_empty());
    }

    #[test]
    fn a_deleted_service_gives_its_ports_back() {
        let mut event = service("LoadBalancer", &json!([{ "port": 80, "nodePort": 31080 }]));
        event["type"] = json!("DELETED");
        let read = ServiceEvent::read(&event).unwrap();
        assert_eq!((read.service.as_str(), read.ports.len()), ("shop/web", 0));
    }
}
