//! Moving another engine's images, volumes and containers (from Docker Desktop's engine, say) into
//! Containeria's: images streamed as `docker save | docker load`, volumes copied file by file
//! through helper containers on both sides, and containers created again from their own settings.

use std::collections::HashMap;
use std::pin::pin;

use bollard::body_try_stream;
use bollard::query_parameters::{
    CreateContainerOptionsBuilder, DownloadFromContainerOptionsBuilder, ImportImageOptionsBuilder,
    InspectContainerOptions, ListContainersOptionsBuilder, ListImagesOptionsBuilder,
    ListVolumesOptions, StartContainerOptions, UploadToContainerOptionsBuilder,
};
use futures::{SinkExt, StreamExt};
use serde::Serialize;

use crate::helper::{Helper, LABEL};
use crate::run::recreate_body;
use crate::volumes::MOUNT;
use crate::{Docker, Error, NetworkSpec, Result};

const COMPOSE_PROJECT: &str = "com.docker.compose.project";
const POD_NAME: &str = "io.kubernetes.pod.name";
/// Networks every engine has; containers on them need nothing created.
const BUILT_IN_NETWORKS: [&str; 3] = ["bridge", "host", "none"];

/// A container another engine runs that can be created again here.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct MovableContainer {
    pub id: String,
    pub name: String,
    pub image: String,
    pub project: Option<String>,
    pub running: bool,
}

/// What another engine has.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Inventory {
    pub images: Vec<String>,
    /// Named volumes; anonymous ones travel with the container that uses them.
    pub volumes: Vec<String>,
    pub containers: Vec<MovableContainer>,
}

/// Docker names anonymous volumes with 64 hex characters.
fn is_anonymous(volume: &str) -> bool {
    volume.len() == 64 && volume.bytes().all(|byte| byte.is_ascii_hexdigit())
}

impl Docker {
    /// Every tagged image, as `repository:tag`. Untagged layers aren't worth moving.
    ///
    /// # Errors
    /// Fails when the engine can't be reached.
    pub async fn image_references(&self) -> Result<Vec<String>> {
        let images = self.api.list_images(Some(ListImagesOptionsBuilder::new().build())).await?;
        let mut references: Vec<String> = images
            .into_iter()
            .flat_map(|image| image.repo_tags)
            .filter(|tag| tag != "<none>:<none>")
            .collect();
        references.sort();
        references.dedup();
        Ok(references)
    }

    /// The images, named volumes and containers worth moving: not Kubernetes' own containers,
    /// not Containeria's helpers.
    ///
    /// # Errors
    /// Fails when the engine can't be reached.
    pub async fn inventory(&self) -> Result<Inventory> {
        let images = self.image_references().await?;
        let mut volumes: Vec<String> = self
            .api
            .list_volumes(None::<ListVolumesOptions>)
            .await?
            .volumes
            .unwrap_or_default()
            .into_iter()
            .map(|volume| volume.name)
            .filter(|name| !is_anonymous(name))
            .collect();
        volumes.sort();
        let options = ListContainersOptionsBuilder::new().all(true).build();
        let containers = self
            .api
            .list_containers(Some(options))
            .await?
            .into_iter()
            .filter_map(|raw| {
                let labels = raw.labels.unwrap_or_default();
                if labels.contains_key(POD_NAME) || labels.contains_key(LABEL) {
                    return None;
                }
                Some(MovableContainer {
                    id: raw.id?,
                    name: raw.names?.first()?.trim_start_matches('/').to_owned(),
                    image: raw.image.unwrap_or_default(),
                    project: labels.get(COMPOSE_PROJECT).cloned(),
                    running: raw.state == Some(bollard::models::ContainerSummaryStateEnum::RUNNING),
                })
            })
            .collect();
        Ok(Inventory { images, volumes, containers })
    }

    /// Streams one image from `self` into `target` the way `docker save | docker load` does,
    /// without writing the archive to disk.
    ///
    /// # Errors
    /// Fails when either engine refuses or the image doesn't exist in `self`.
    pub async fn copy_image_to(&self, target: &Docker, reference: &str) -> Result<()> {
        let archive = self.api.export_image(reference);
        let options = ImportImageOptionsBuilder::new().quiet(true).build();
        let mut loading = pin!(target.api.import_image_stream(options, archive, None));
        while let Some(progress) = loading.next().await {
            if let Some(message) = progress?.error_detail.and_then(|detail| detail.message) {
                return Err(Error::Engine(message));
            }
        }
        Ok(())
    }

    /// Copies every file of volume `name` into a volume of the same name in `target`, which is
    /// created when missing. Reads through a read-only helper here and writes through one there.
    ///
    /// # Errors
    /// Fails when either engine refuses or the copy is cut off.
    pub async fn copy_volume_to(&self, target: &Docker, name: &str) -> Result<()> {
        if target.api.inspect_volume(name).await.is_err() {
            target.create_volume(name).await?;
        }
        let reader = Helper::create(self, vec![format!("{name}:{MOUNT}:ro")], &["true"]).await?;
        let writer = Helper::create(target, vec![format!("{name}:{MOUNT}")], &["true"]).await?;
        let (mut send, receive) =
            futures::channel::mpsc::channel::<std::io::Result<bytes::Bytes>>(8);
        let source = self.api.clone();
        let reader_id = reader.id.clone();
        let pump = tokio::spawn(async move {
            let options = DownloadFromContainerOptionsBuilder::new().path(MOUNT).build();
            let mut chunks = pin!(source.download_from_container(&reader_id, Some(options)));
            while let Some(chunk) = chunks.next().await {
                let chunk = chunk.map_err(std::io::Error::other);
                let failed = chunk.is_err();
                if send.send(chunk).await.is_err() || failed {
                    break;
                }
            }
        });
        let options = UploadToContainerOptionsBuilder::new().path("/").build();
        let uploaded = target
            .api
            .upload_to_container(&writer.id, Some(options), body_try_stream(receive))
            .await;
        let pumped = pump.await;
        reader.remove().await?;
        writer.remove().await?;
        pumped.map_err(|error| Error::Engine(error.to_string()))?;
        Ok(uploaded?)
    }

    /// Creates container `id` again in `target` with its name, settings, ports, networks and
    /// volumes. Its image and the volumes it mounts are copied first when `target` lacks them.
    /// With `start`, it starts there if it was running here. Returns the new container's ID.
    ///
    /// # Errors
    /// Fails when the name is taken in `target` or a piece can't be copied.
    pub async fn copy_container_to(
        &self,
        target: &Docker,
        id: &str,
        start: bool,
    ) -> Result<String> {
        let inspect = self.api.inspect_container(id, None::<InspectContainerOptions>).await?;
        let name = inspect.name.clone().unwrap_or_default().trim_start_matches('/').to_owned();
        let running = inspect.state.as_ref().and_then(|state| state.running).unwrap_or(false);
        let image =
            inspect.config.as_ref().and_then(|config| config.image.clone()).unwrap_or_default();
        let body = recreate_body(inspect)?;
        if target.api.inspect_image(&image).await.is_err() {
            self.copy_image_to(target, &image).await?;
        }
        let binds =
            body.host_config.as_ref().and_then(|host| host.binds.clone()).unwrap_or_default();
        for volume in binds
            .iter()
            .filter_map(|bind| bind.split(':').next())
            .filter(|source| !source.starts_with('/'))
        {
            if target.api.inspect_volume(volume).await.is_err() {
                self.copy_volume_to(target, volume).await?;
            }
        }
        let networks: Vec<String> = body
            .networking_config
            .as_ref()
            .and_then(|config| config.endpoints_config.as_ref())
            .map(|endpoints| endpoints.keys().cloned().collect())
            .unwrap_or_default();
        for network in
            networks.iter().filter(|network| !BUILT_IN_NETWORKS.contains(&network.as_str()))
        {
            if target.api.inspect_network(network, None).await.is_err() {
                self.copy_network_to(target, network).await?;
            }
        }
        let options = CreateContainerOptionsBuilder::new().name(&name).build();
        let created = target.api.create_container(Some(options), body).await?;
        if start && running {
            target.api.start_container(&created.id, None::<StartContainerOptions>).await?;
        }
        Ok(created.id)
    }

    /// Creates network `name` in `target` with the same driver and labels, so Compose still
    /// recognises it as its project's network.
    async fn copy_network_to(&self, target: &Docker, name: &str) -> Result<()> {
        let source = self.api.inspect_network(name, None).await?;
        let labels: HashMap<String, String> = source.labels.unwrap_or_default();
        let mut request = bollard::models::NetworkCreateRequest::from(NetworkSpec {
            name: name.to_owned(),
            driver: source.driver.unwrap_or_else(|| "bridge".to_owned()),
            subnet: None,
            gateway: None,
            internal: source.internal.unwrap_or(false),
            ipv6: source.enable_ipv6.unwrap_or(false),
        });
        request.labels = Some(labels);
        target.api.create_network(request).await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn leaves_anonymous_volumes_to_their_containers() {
        assert!(is_anonymous("3f2a9c41d0e8aaaa3f2a9c41d0e8aaaa3f2a9c41d0e8aaaa3f2a9c41d0e8aaaa"));
        assert!(!is_anonymous("shop_pgdata"));
    }
}
