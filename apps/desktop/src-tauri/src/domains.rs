use std::sync::Arc;
use std::time::Duration;

use containeria_net::{ClusterService, Domains};

use crate::engine::Engine;
use crate::kubernetes::Kubernetes;

const REFRESH_EVERY: Duration = Duration::from_secs(3);

/// Runs for the life of the app: keeps the DNS server and proxy up while domains are on, and the
/// route table in step with the containers and the Kubernetes services the Mac can reach.
// ponytail: polls the container list; switch to Docker events if 3 s ever feels slow.
pub(crate) async fn supervise(
    domains: Arc<Domains>,
    engine: Arc<Engine>,
    kubernetes: Arc<Kubernetes>,
) {
    loop {
        if domains.enabled() {
            if let Err(error) = domains.start().await {
                tracing::warn!(%error, "domains couldn't start");
            }
            let containers = match engine.docker().await {
                Ok(docker) => docker.containers().await.unwrap_or_default(),
                Err(_) => Vec::new(),
            };
            domains.set_containers(containers);
            domains.set_services(services(&kubernetes, &engine).await);
        }
        tokio::time::sleep(REFRESH_EVERY).await;
    }
}

/// Services a domain can reach: those with a port forwarded to the Mac. None while Kubernetes is off.
async fn services(kubernetes: &Kubernetes, engine: &Engine) -> Vec<ClusterService> {
    let Ok(client) = kubernetes.client(engine).await else { return Vec::new() };
    client
        .services()
        .await
        .unwrap_or_default()
        .into_iter()
        .filter_map(|service| {
            let mac_port = service.mac_port()?;
            let port = service.ports.first()?.port;
            Some(ClusterService {
                namespace: service.namespace,
                name: service.name,
                port,
                mac_port,
            })
        })
        .collect()
}
