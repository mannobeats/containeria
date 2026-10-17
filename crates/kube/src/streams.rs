use std::net::{Ipv4Addr, SocketAddr};

use futures::{AsyncBufReadExt, Stream, StreamExt, TryStreamExt, stream};
use k8s_openapi::api::apps::v1::Deployment;
use k8s_openapi::api::core::v1::{Pod, Service};
use kube::Api;
use kube::api::LogParams;
use kube::runtime::{WatchStreamExt, watcher};
use tokio::net::TcpListener;

use crate::{Error, Kube, Result};

impl Kube {
    /// Follows a pod's log from its last `tail` lines.
    ///
    /// # Errors
    /// Fails when the pod is gone or has no container by that name.
    pub async fn logs(
        &self,
        namespace: &str,
        pod: &str,
        container: Option<String>,
        tail: i64,
    ) -> Result<impl Stream<Item = Result<String>> + use<>> {
        let params =
            LogParams { follow: true, tail_lines: Some(tail), container, ..LogParams::default() };
        let reader = self.namespaced::<Pod>(namespace).log_stream(pod, &params).await?;
        Ok(reader.lines().map_err(|error| Error::Unreachable(error.to_string())))
    }

    /// Listens on `localhost:local_port` and tunnels each connection to `pod_port` in the pod, until
    /// the returned future is dropped.
    ///
    /// # Errors
    /// Fails at once when the local port is taken; later connection errors only end that connection.
    pub async fn port_forward(
        &self,
        namespace: &str,
        pod: &str,
        local_port: u16,
        pod_port: u16,
    ) -> Result<impl Future<Output = ()> + use<>> {
        let listener = TcpListener::bind(SocketAddr::from((Ipv4Addr::LOCALHOST, local_port)))
            .await
            .map_err(|error| Error::Api(format!("localhost:{local_port} is not free: {error}")))?;
        let api: Api<Pod> = self.namespaced(namespace);
        let pod = pod.to_owned();
        Ok(async move {
            while let Ok((mut connection, _)) = listener.accept().await {
                let (api, pod) = (api.clone(), pod.clone());
                tokio::spawn(async move {
                    let Ok(mut forwarder) = api.portforward(&pod, &[pod_port]).await else {
                        return;
                    };
                    if let Some(mut upstream) = forwarder.take_stream(pod_port) {
                        let _ = tokio::io::copy_bidirectional(&mut connection, &mut upstream).await;
                    }
                    let _ = forwarder.join().await;
                });
            }
        })
    }

    /// Yields whenever a pod, deployment or service changes anywhere in the cluster.
    pub fn changes(&self) -> impl Stream<Item = Result<()>> + use<> {
        let config = watcher::Config::default();
        let pods =
            watcher(self.all::<Pod>(), config.clone()).touched_objects().map_ok(drop).boxed();
        let deployments = watcher(self.all::<Deployment>(), config.clone())
            .touched_objects()
            .map_ok(drop)
            .boxed();
        let services =
            watcher(self.all::<Service>(), config).touched_objects().map_ok(drop).boxed();
        stream::select_all([pods, deployments, services])
            .map_err(|error| Error::Unreachable(error.to_string()))
    }
}
