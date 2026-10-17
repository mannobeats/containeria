use std::collections::BTreeMap;

use k8s_openapi::api::apps::v1::Deployment;
use k8s_openapi::api::core::v1::{ConfigMap, Event, Pod, Secret, Service};
use k8s_openapi::api::networking::v1::Ingress;
use k8s_openapi::apimachinery::pkg::apis::meta::v1::{ObjectMeta, Time};
use serde::{Deserialize, Serialize};

/// Waiting or terminated reasons that mean a pod needs attention.
const PROBLEMS: [&str; 7] = [
    "CrashLoopBackOff",
    "Error",
    "ImagePullBackOff",
    "ErrImagePull",
    "OOMKilled",
    "CreateContainerConfigError",
    "InvalidImageName",
];

/// Everything the Kubernetes view shows, read in one pass.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Cluster {
    pub version: String,
    pub namespaces: Vec<String>,
    pub pods: Vec<PodSummary>,
    pub deployments: Vec<DeploymentSummary>,
    pub services: Vec<ServiceSummary>,
    pub ingresses: Vec<IngressSummary>,
    pub config: Vec<ConfigSummary>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PodSummary {
    pub namespace: String,
    pub name: String,
    /// The STATUS column of `kubectl get pods`: a container's waiting reason, or the phase.
    pub status: String,
    /// Set when the status means the pod is failing, like `CrashLoopBackOff`.
    pub problem: Option<String>,
    pub ready: u32,
    pub containers: Vec<String>,
    pub restarts: u32,
    pub node: Option<String>,
    pub ip: Option<String>,
    /// `Kind/name` of the controller that owns the pod.
    pub owner: Option<String>,
    #[specta(type = specta_typescript::Number)]
    pub created_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct DeploymentSummary {
    pub namespace: String,
    pub name: String,
    pub ready: u32,
    pub desired: u32,
    pub up_to_date: u32,
    pub available: u32,
    pub images: Vec<String>,
    #[specta(type = specta_typescript::Number)]
    pub created_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ServicePort {
    pub port: u16,
    pub target: String,
    pub protocol: String,
    pub node_port: Option<u16>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ServiceSummary {
    pub namespace: String,
    pub name: String,
    pub kind: String,
    pub cluster_ip: Option<String>,
    pub ports: Vec<ServicePort>,
    /// `localhost:port` for a `LoadBalancer` service: k3s binds it in the VM and Lima forwards it.
    pub from_mac: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct IngressRoute {
    pub host: String,
    pub path: String,
    pub backend: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct IngressSummary {
    pub namespace: String,
    pub name: String,
    pub class: Option<String>,
    pub tls: bool,
    pub routes: Vec<IngressRoute>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum ConfigKind {
    ConfigMap,
    Secret,
}

/// A config map or secret. Only key names cross to the UI; secret values on request.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ConfigSummary {
    pub namespace: String,
    pub name: String,
    pub kind: ConfigKind,
    pub secret_type: Option<String>,
    pub keys: Vec<String>,
    #[specta(type = specta_typescript::Number)]
    pub created_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct KubeEvent {
    pub warning: bool,
    pub reason: String,
    pub message: String,
    pub count: u32,
    #[specta(type = specta_typescript::Number)]
    pub last_seen: i64,
}

fn names(meta: &ObjectMeta) -> (String, String) {
    (meta.namespace.clone().unwrap_or_default(), meta.name.clone().unwrap_or_default())
}

fn seconds(time: Option<&Time>) -> i64 {
    time.map_or(0, |time| time.0.as_second())
}

fn count(value: Option<i32>) -> u32 {
    value.and_then(|value| u32::try_from(value).ok()).unwrap_or(0)
}

impl From<&Pod> for PodSummary {
    fn from(pod: &Pod) -> Self {
        let (namespace, name) = names(&pod.metadata);
        let spec = pod.spec.as_ref();
        let status = pod.status.as_ref();
        let containers =
            status.and_then(|status| status.container_statuses.as_deref()).unwrap_or_default();
        let reason = containers.iter().find_map(|container| {
            let state = container.state.as_ref()?;
            state
                .waiting
                .as_ref()
                .and_then(|waiting| waiting.reason.clone())
                .or_else(|| {
                    state.terminated.as_ref().and_then(|terminated| terminated.reason.clone())
                })
                .filter(|reason| reason != "Completed" || !container.ready)
        });
        let phase =
            status.and_then(|status| status.phase.clone()).unwrap_or_else(|| "Pending".to_owned());
        let display = if pod.metadata.deletion_timestamp.is_some() {
            "Terminating".to_owned()
        } else {
            reason.unwrap_or_else(
                || if phase == "Succeeded" { "Completed".to_owned() } else { phase },
            )
        };
        Self {
            namespace,
            name,
            problem: PROBLEMS.contains(&display.as_str()).then(|| display.clone()),
            status: display,
            ready: u32::try_from(containers.iter().filter(|container| container.ready).count())
                .unwrap_or(u32::MAX),
            containers: spec
                .map(|spec| {
                    spec.containers.iter().map(|container| container.name.clone()).collect()
                })
                .unwrap_or_default(),
            restarts: containers.iter().map(|container| count(Some(container.restart_count))).sum(),
            node: spec.and_then(|spec| spec.node_name.clone()),
            ip: status.and_then(|status| status.pod_ip.clone()),
            owner: pod
                .metadata
                .owner_references
                .as_deref()
                .and_then(<[_]>::first)
                .map(|owner| format!("{}/{}", owner.kind, owner.name)),
            created_at: seconds(pod.metadata.creation_timestamp.as_ref()),
        }
    }
}

impl From<&Deployment> for DeploymentSummary {
    fn from(deployment: &Deployment) -> Self {
        let (namespace, name) = names(&deployment.metadata);
        let status = deployment.status.as_ref();
        let template = deployment.spec.as_ref().and_then(|spec| spec.template.spec.as_ref());
        Self {
            namespace,
            name,
            ready: count(status.and_then(|status| status.ready_replicas)),
            desired: count(deployment.spec.as_ref().and_then(|spec| spec.replicas).or(Some(1))),
            up_to_date: count(status.and_then(|status| status.updated_replicas)),
            available: count(status.and_then(|status| status.available_replicas)),
            images: template
                .map(|spec| {
                    spec.containers.iter().filter_map(|container| container.image.clone()).collect()
                })
                .unwrap_or_default(),
            created_at: seconds(deployment.metadata.creation_timestamp.as_ref()),
        }
    }
}

impl From<&Service> for ServiceSummary {
    fn from(service: &Service) -> Self {
        let (namespace, name) = names(&service.metadata);
        let spec = service.spec.as_ref();
        let kind =
            spec.and_then(|spec| spec.type_.clone()).unwrap_or_else(|| "ClusterIP".to_owned());
        let ports: Vec<ServicePort> = spec
            .and_then(|spec| spec.ports.as_deref())
            .unwrap_or_default()
            .iter()
            .map(|port| ServicePort {
                port: u16::try_from(port.port).unwrap_or(0),
                target: port
                    .target_port
                    .as_ref()
                    .map_or_else(|| port.port.to_string(), int_or_string),
                protocol: port.protocol.clone().unwrap_or_else(|| "TCP".to_owned()),
                node_port: port.node_port.and_then(|node_port| u16::try_from(node_port).ok()),
            })
            .collect();
        let from_mac = (kind == "LoadBalancer")
            .then(|| ports.first().map(|port| format!("localhost:{}", port.port)))
            .flatten();
        Self {
            namespace,
            name,
            cluster_ip: spec.and_then(|spec| spec.cluster_ip.clone()).filter(|ip| ip != "None"),
            kind,
            ports,
            from_mac,
        }
    }
}

fn int_or_string(value: &k8s_openapi::apimachinery::pkg::util::intstr::IntOrString) -> String {
    use k8s_openapi::apimachinery::pkg::util::intstr::IntOrString;
    match value {
        IntOrString::Int(number) => number.to_string(),
        IntOrString::String(name) => name.clone(),
    }
}

impl From<&Ingress> for IngressSummary {
    fn from(ingress: &Ingress) -> Self {
        let (namespace, name) = names(&ingress.metadata);
        let spec = ingress.spec.as_ref();
        let routes = spec
            .and_then(|spec| spec.rules.as_deref())
            .unwrap_or_default()
            .iter()
            .flat_map(|rule| {
                let host = rule.host.clone().unwrap_or_else(|| "*".to_owned());
                rule.http.iter().flat_map(|http| http.paths.iter()).map(move |path| IngressRoute {
                    host: host.clone(),
                    path: path.path.clone().unwrap_or_else(|| "/".to_owned()),
                    backend: path.backend.service.as_ref().map_or_else(String::new, |service| {
                        let port = service.port.as_ref().and_then(|port| {
                            port.number
                                .map(|number| number.to_string())
                                .or_else(|| port.name.clone())
                        });
                        port.map_or_else(
                            || service.name.clone(),
                            |port| format!("{}:{port}", service.name),
                        )
                    }),
                })
            })
            .collect();
        Self {
            namespace,
            name,
            class: spec.and_then(|spec| spec.ingress_class_name.clone()),
            tls: spec.and_then(|spec| spec.tls.as_ref()).is_some_and(|tls| !tls.is_empty()),
            routes,
        }
    }
}

impl From<&ConfigMap> for ConfigSummary {
    fn from(map: &ConfigMap) -> Self {
        let (namespace, name) = names(&map.metadata);
        let mut keys: Vec<String> = map
            .data
            .iter()
            .flat_map(BTreeMap::keys)
            .chain(map.binary_data.iter().flat_map(BTreeMap::keys))
            .cloned()
            .collect();
        keys.sort();
        Self {
            namespace,
            name,
            kind: ConfigKind::ConfigMap,
            secret_type: None,
            keys,
            created_at: seconds(map.metadata.creation_timestamp.as_ref()),
        }
    }
}

impl From<&Secret> for ConfigSummary {
    fn from(secret: &Secret) -> Self {
        let (namespace, name) = names(&secret.metadata);
        let keys = secret.data.iter().flat_map(BTreeMap::keys).cloned().collect();
        Self {
            namespace,
            name,
            kind: ConfigKind::Secret,
            secret_type: secret.type_.clone(),
            keys,
            created_at: seconds(secret.metadata.creation_timestamp.as_ref()),
        }
    }
}

impl From<&Event> for KubeEvent {
    fn from(event: &Event) -> Self {
        let last_seen = event.last_timestamp.as_ref().or(event.first_timestamp.as_ref());
        Self {
            warning: event.type_.as_deref() == Some("Warning"),
            reason: event.reason.clone().unwrap_or_default(),
            message: event.message.clone().unwrap_or_default(),
            count: count(event.count).max(1),
            last_seen: seconds(last_seen)
                .max(event.event_time.as_ref().map_or(0, |time| time.0.as_second())),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pod(json: &str) -> PodSummary {
        PodSummary::from(&serde_json::from_str::<Pod>(json).unwrap())
    }

    #[test]
    fn reads_a_crash_looping_pod_like_kubectl() {
        let summary = pod(r#"{
            "metadata": {"name": "checkout-7d9f8b-x2", "namespace": "shop",
                "creationTimestamp": "2026-10-17T10:00:00Z",
                "ownerReferences": [{"apiVersion": "apps/v1", "kind": "ReplicaSet", "name": "checkout-7d9f8b", "uid": "u"}]},
            "spec": {"nodeName": "colima-containeria", "containers": [{"name": "checkout", "image": "shop-checkout:dev"}]},
            "status": {"phase": "Running", "podIP": "10.42.0.17", "containerStatuses": [{
                "name": "checkout", "ready": false, "restartCount": 14, "image": "shop-checkout:dev", "imageID": "",
                "state": {"waiting": {"reason": "CrashLoopBackOff", "message": "back-off 5m0s"}}}]}
        }"#);
        assert_eq!(summary.status, "CrashLoopBackOff");
        assert_eq!(summary.problem.as_deref(), Some("CrashLoopBackOff"));
        assert_eq!((summary.ready, summary.restarts), (0, 14));
        assert_eq!(summary.owner.as_deref(), Some("ReplicaSet/checkout-7d9f8b"));
        assert_eq!(summary.containers, ["checkout"]);
        assert_eq!(summary.created_at, 1_792_231_200);
    }

    #[test]
    fn a_finished_job_pod_reads_completed_and_is_fine() {
        let summary = pod(r#"{
            "metadata": {"name": "migrate", "namespace": "shop"},
            "spec": {"containers": [{"name": "migrate"}]},
            "status": {"phase": "Succeeded", "containerStatuses": [{"name": "migrate", "ready": false, "restartCount": 0,
                "image": "", "imageID": "", "state": {"terminated": {"exitCode": 0, "reason": "Completed"}}}]}
        }"#);
        assert_eq!(summary.status, "Completed");
        assert_eq!(summary.problem, None);
    }

    #[test]
    fn a_deleted_pod_reads_terminating() {
        let summary =
            pod(r#"{"metadata": {"name": "web", "deletionTimestamp": "2026-10-17T10:00:00Z"},
            "status": {"phase": "Running"}}"#);
        assert_eq!(summary.status, "Terminating");
    }

    #[test]
    fn reads_deployment_rollout_counts() {
        let deployment: Deployment = serde_json::from_str(r#"{
            "metadata": {"name": "storefront", "namespace": "shop"},
            "spec": {"replicas": 3, "selector": {}, "template": {"spec": {"containers": [{"name": "web", "image": "shop-web:dev"}]}}},
            "status": {"readyReplicas": 2, "updatedReplicas": 3, "availableReplicas": 2}
        }"#).unwrap();
        let summary = DeploymentSummary::from(&deployment);
        assert_eq!(
            (summary.ready, summary.desired, summary.up_to_date, summary.available),
            (2, 3, 3, 2)
        );
        assert_eq!(summary.images, ["shop-web:dev"]);
    }

    #[test]
    fn a_load_balancer_service_is_reachable_on_localhost() {
        let service: Service = serde_json::from_str(r#"{
            "metadata": {"name": "storefront", "namespace": "shop"},
            "spec": {"type": "LoadBalancer", "clusterIP": "10.43.12.4",
                "ports": [{"port": 8080, "targetPort": "http", "protocol": "TCP", "nodePort": 31234}]}
        }"#).unwrap();
        let summary = ServiceSummary::from(&service);
        assert_eq!(summary.from_mac.as_deref(), Some("localhost:8080"));
        assert_eq!(summary.ports[0].target, "http");
        assert_eq!(summary.ports[0].node_port, Some(31234));
    }

    #[test]
    fn a_headless_service_has_no_cluster_ip() {
        let service: Service =
            serde_json::from_str(r#"{"metadata": {"name": "db"}, "spec": {"clusterIP": "None"}}"#)
                .unwrap();
        let summary = ServiceSummary::from(&service);
        assert_eq!(
            (summary.cluster_ip, summary.kind.as_str(), summary.from_mac),
            (None, "ClusterIP", None)
        );
    }

    #[test]
    fn flattens_ingress_rules_into_routes() {
        let ingress: Ingress = serde_json::from_str(r#"{
            "metadata": {"name": "storefront", "namespace": "shop"},
            "spec": {"ingressClassName": "traefik", "tls": [{"hosts": ["shop.test"]}],
                "rules": [{"host": "shop.test", "http": {"paths": [
                    {"path": "/", "pathType": "Prefix", "backend": {"service": {"name": "web", "port": {"number": 80}}}},
                    {"path": "/api", "pathType": "Prefix", "backend": {"service": {"name": "api", "port": {"name": "http"}}}}]}}]}
        }"#).unwrap();
        let summary = IngressSummary::from(&ingress);
        assert!(summary.tls);
        assert_eq!(
            summary.routes[1],
            IngressRoute {
                host: "shop.test".into(),
                path: "/api".into(),
                backend: "api:http".into()
            }
        );
    }

    #[test]
    fn lists_secret_keys_without_values() {
        let secret: Secret = serde_json::from_str(
            r#"{"metadata": {"name": "db"}, "type": "Opaque",
            "data": {"password": "aHVudGVyMg==", "username": "YWRh"}}"#,
        )
        .unwrap();
        let summary = ConfigSummary::from(&secret);
        assert_eq!(summary.keys, ["password", "username"]);
        assert_eq!(summary.secret_type.as_deref(), Some("Opaque"));
        assert!(!serde_json::to_string(&summary).unwrap().contains("aHVudGVyMg"));
    }

    #[test]
    fn reads_warning_events() {
        let event: Event = serde_json::from_str(r#"{"metadata": {"name": "e"}, "involvedObject": {},
            "type": "Warning", "reason": "BackOff", "message": "Back-off restarting failed container", "count": 9,
            "lastTimestamp": "2026-10-17T10:00:00Z"}"#).unwrap();
        let summary = KubeEvent::from(&event);
        assert!(summary.warning);
        assert_eq!((summary.count, summary.last_seen), (9, 1_792_231_200));
    }
}
