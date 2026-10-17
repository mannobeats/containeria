use std::sync::Arc;
use std::time::Duration;

use containeria_net::Domains;

use crate::engine::Engine;

const REFRESH_EVERY: Duration = Duration::from_secs(3);

/// Runs for the life of the app: keeps the DNS server and proxy up while domains are on, and the
/// route table in step with the containers.
// ponytail: polls the container list; switch to Docker events if 3 s ever feels slow.
pub(crate) async fn supervise(domains: Arc<Domains>, engine: Arc<Engine>) {
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
        }
        tokio::time::sleep(REFRESH_EVERY).await;
    }
}
