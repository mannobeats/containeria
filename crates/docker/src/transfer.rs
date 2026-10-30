//! Moving another engine's images, volumes and containers (from Docker Desktop's engine, say) into
//! Containeria's: images streamed as `docker save | docker load`, volumes copied file by file
//! through helper containers on both sides, and containers created again from their own settings.

use std::collections::HashMap;
use std::pin::pin;

use bollard::body_try_stream;
use bollard::models::VolumeCreateRequest;
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

/// A named volume another engine has.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct MovableVolume {
    pub name: String,
    /// Running containers that mount it. Copying it now may catch a database mid-write.
    pub in_use_by: Vec<String>,
}

/// What another engine has.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Inventory {
    pub images: Vec<String>,
    /// Named volumes; anonymous ones travel with the container that uses them.
    pub volumes: Vec<MovableVolume>,
    pub containers: Vec<MovableContainer>,
}

/// Docker names anonymous volumes with 64 hex characters.
fn is_anonymous(volume: &str) -> bool {
    volume.len() == 64 && volume.bytes().all(|byte| byte.is_ascii_hexdigit())
}

/// The request that creates `volume` again on another engine with its driver and labels (so
/// Compose adopts it as its own), and whether its files need copying. A volume whose options
/// mount something else (`type=nfs`, `cifs`, `tmpfs`), or that a plugin keeps, is created with
/// the same options and its files stay where they live. A bind to a folder inside the old
/// engine's VM can't point anywhere here, so it becomes a plain volume holding a copy.
fn recreation(volume: &bollard::models::Volume) -> (VolumeCreateRequest, bool) {
    let options = &volume.options;
    let bind = options.get("o").is_some_and(|o| o.split(',').any(|part| part == "bind"));
    let mounts = options.get("type").is_some_and(|kind| !kind.is_empty() && kind != "none");
    let request = VolumeCreateRequest {
        name: Some(volume.name.clone()),
        driver: Some(volume.driver.clone()),
        driver_opts: Some(if bind { HashMap::new() } else { options.clone() }),
        labels: Some(volume.labels.clone()),
        ..Default::default()
    };
    (request, volume.driver == "local" && !mounts)
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
        let options = ListContainersOptionsBuilder::new().all(true).build();
        let raw = self.api.list_containers(Some(options)).await?;
        let mut in_use: HashMap<String, Vec<String>> = HashMap::new();
        for container in &raw {
            if container.state != Some(bollard::models::ContainerSummaryStateEnum::RUNNING) {
                continue;
            }
            let name = container.names.iter().flatten().next().map_or("", |name| name.as_str());
            for mount in container.mounts.iter().flatten() {
                if let (Some("volume"), Some(volume)) = (mount.typ.as_deref(), &mount.name) {
                    in_use
                        .entry(volume.clone())
                        .or_default()
                        .push(name.trim_start_matches('/').to_owned());
                }
            }
        }
        let mut volumes: Vec<MovableVolume> = self
            .api
            .list_volumes(None::<ListVolumesOptions>)
            .await?
            .volumes
            .unwrap_or_default()
            .into_iter()
            .filter(|volume| !is_anonymous(&volume.name))
            .map(|volume| MovableVolume {
                in_use_by: in_use.remove(&volume.name).unwrap_or_default(),
                name: volume.name,
            })
            .collect();
        volumes.sort_by(|a, b| a.name.cmp(&b.name));
        let containers = raw
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
    /// created when missing with the source's driver, labels and options (see [`recreation`]).
    /// Reads through a read-only helper here and writes through one there. Running containers
    /// that use the volume keep running, so a database may be copied mid-write; callers warn.
    ///
    /// Ownership stays numeric. The helpers are only created, never started, so nothing inside
    /// them (busybox's `tar`, its `/etc/passwd`) touches the files: both ends are the daemons'
    /// own archive code. Download writes each file's numeric uid and gid with no user names
    /// (`FileInfoHeaderNoLookups` in moby's go-archive), the stream is passed on byte for byte,
    /// and upload without `copyUIDGID` lchowns each file to the uid and gid in its header. So a
    /// Postgres volume owned by 999 stays 999 whatever image the helper is; only an engine with
    /// user-namespace remapping shifts ids, and it shifts them back on the other side.
    ///
    /// # Errors
    /// Fails when either engine refuses or the copy is cut off.
    pub async fn copy_volume_to(&self, target: &Docker, name: &str) -> Result<()> {
        let (request, copy_files) = recreation(&self.api.inspect_volume(name).await?);
        if target.api.inspect_volume(name).await.is_err() {
            target.api.create_volume(request).await?;
        }
        if !copy_files {
            return Ok(());
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
    use std::path::Path;
    use std::sync::{Arc, Mutex};

    use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
    use tokio::net::UnixListener;

    use super::*;

    #[derive(Debug)]
    struct Request {
        method: String,
        path: String,
        body: Vec<u8>,
    }

    type Respond = fn(&str, &str) -> (u16, Vec<u8>);

    /// A Docker engine on a Unix socket in `dir`: `respond(method, path)` answers each request,
    /// one per connection, and every request is recorded with its body.
    fn fake_engine(dir: &Path, respond: Respond) -> (Docker, Arc<Mutex<Vec<Request>>>) {
        let socket = dir.join("docker.sock");
        let listener = UnixListener::bind(&socket).unwrap();
        let seen = Arc::new(Mutex::new(Vec::new()));
        let record = seen.clone();
        tokio::spawn(async move {
            while let Ok((stream, _)) = listener.accept().await {
                let record = record.clone();
                tokio::spawn(async move {
                    let mut stream = BufReader::new(stream);
                    let request = read_request(&mut stream).await;
                    let (status, reply) = respond(&request.method, &request.path);
                    record.lock().unwrap().push(request);
                    let head = format!(
                        "HTTP/1.1 {status} X\r\nContent-Type: application/json\r\n\
                         Content-Length: {}\r\nConnection: close\r\n\r\n",
                        reply.len()
                    );
                    let stream = stream.get_mut();
                    stream.write_all(head.as_bytes()).await.unwrap();
                    stream.write_all(&reply).await.unwrap();
                    stream.shutdown().await.unwrap();
                });
            }
        });
        (Docker::connect(&socket).unwrap(), seen)
    }

    async fn read_request(stream: &mut BufReader<tokio::net::UnixStream>) -> Request {
        let mut line = String::new();
        stream.read_line(&mut line).await.unwrap();
        let mut parts = line.split_whitespace();
        let method = parts.next().unwrap().to_owned();
        let path = parts.next().unwrap().to_owned();
        let (mut length, mut chunked) = (0, false);
        loop {
            let mut header = String::new();
            stream.read_line(&mut header).await.unwrap();
            let Some((name, value)) = header.trim_end().split_once(':') else { break };
            match name.to_ascii_lowercase().as_str() {
                "content-length" => length = value.trim().parse().unwrap(),
                "transfer-encoding" => chunked = value.contains("chunked"),
                _ => {}
            }
        }
        let mut body = vec![0; length];
        stream.read_exact(&mut body).await.unwrap();
        while chunked {
            let mut size = String::new();
            stream.read_line(&mut size).await.unwrap();
            let size = usize::from_str_radix(size.trim(), 16).unwrap();
            let mut chunk = vec![0; size + 2];
            stream.read_exact(&mut chunk).await.unwrap();
            body.extend_from_slice(&chunk[..size]);
            chunked = size > 0;
        }
        Request { method, path, body }
    }

    /// What the archive API hands out for a Postgres data volume: numeric ids, no user names.
    fn postgres_archive() -> Vec<u8> {
        let mut archive = tar::Builder::new(Vec::new());
        for (path, data) in [("v/", &b""[..]), ("v/PG_VERSION", &b"18\n"[..])] {
            let mut header = tar::Header::new_ustar();
            header.set_entry_type(if data.is_empty() {
                tar::EntryType::Directory
            } else {
                tar::EntryType::Regular
            });
            header.set_mode(0o700);
            header.set_uid(999);
            header.set_gid(999);
            header.set_size(data.len() as u64);
            archive.append_data(&mut header, path, data).unwrap();
        }
        archive.into_inner().unwrap()
    }

    fn postgres_volume() -> serde_json::Value {
        serde_json::json!({
            "Name": "shop_pgdata", "Driver": "local", "Mountpoint": "/var/lib/docker/volumes/x",
            "Scope": "local", "Options": {},
            "Labels": {
                "com.docker.compose.project": "shop",
                "com.docker.compose.volume": "pgdata",
                "com.docker.compose.version": "2.40.3",
            },
        })
    }

    fn source(method: &str, path: &str) -> (u16, Vec<u8>) {
        match (method, path.split('?').next().unwrap()) {
            ("GET", "/volumes/shop_pgdata") => (200, postgres_volume().to_string().into()),
            ("POST", "/containers/create") => (201, br#"{"Id":"reader","Warnings":[]}"#.into()),
            ("GET", "/containers/reader/archive") => (200, postgres_archive()),
            ("DELETE", _) => (204, Vec::new()),
            _ => (200, b"{}".into()),
        }
    }

    fn target(method: &str, path: &str) -> (u16, Vec<u8>) {
        match (method, path.split('?').next().unwrap()) {
            ("GET", "/volumes/shop_pgdata") => (404, br#"{"message":"no such volume"}"#.into()),
            ("POST", "/volumes/create") => (201, postgres_volume().to_string().into()),
            ("POST", "/containers/create") => (201, br#"{"Id":"writer","Warnings":[]}"#.into()),
            ("DELETE", _) => (204, Vec::new()),
            _ => (200, b"{}".into()),
        }
    }

    #[tokio::test]
    async fn copies_a_volume_with_its_compose_labels_and_numeric_owners() {
        let (here, there) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        let (from, _) = fake_engine(here.path(), source);
        let (to, seen) = fake_engine(there.path(), target);
        from.copy_volume_to(&to, "shop_pgdata").await.unwrap();
        let seen = seen.lock().unwrap();
        let created = seen.iter().find(|request| request.path == "/volumes/create").unwrap();
        let created: serde_json::Value = serde_json::from_slice(&created.body).unwrap();
        assert_eq!(created["Labels"], postgres_volume()["Labels"]);
        assert_eq!(created["Driver"], "local");
        let upload = seen.iter().find(|request| request.method == "PUT").unwrap();
        assert!(upload.path.starts_with("/containers/writer/archive"));
        assert!(!upload.path.contains("copyUIDGID"), "would chown to the helper's user");
        assert_eq!(upload.body, postgres_archive(), "the archive passes through untouched");
        let mut archive = tar::Archive::new(upload.body.as_slice());
        for entry in archive.entries().unwrap() {
            let header = entry.unwrap().header().clone();
            assert_eq!((header.uid().unwrap(), header.gid().unwrap()), (999, 999));
        }
    }

    fn volume(options: &[(&str, &str)]) -> bollard::models::Volume {
        bollard::models::Volume {
            name: "media".to_owned(),
            driver: "local".to_owned(),
            labels: HashMap::from([(COMPOSE_PROJECT.to_owned(), "shop".to_owned())]),
            options: options.iter().map(|(k, v)| ((*k).to_owned(), (*v).to_owned())).collect(),
            ..Default::default()
        }
    }

    #[test]
    fn creates_a_plain_volume_again_with_its_labels_and_copies_its_files() {
        let (request, copy) = recreation(&volume(&[]));
        assert_eq!(request.labels.unwrap()[COMPOSE_PROJECT], "shop");
        assert_eq!(request.driver.as_deref(), Some("local"));
        assert!(copy);
    }

    #[test]
    fn keeps_a_network_share_pointing_at_the_share_without_copying_into_it() {
        let options = [("type", "nfs"), ("o", "addr=10.0.0.2,rw"), ("device", ":/media")];
        let (request, copy) = recreation(&volume(&options));
        assert_eq!(request.driver_opts.unwrap()["device"], ":/media");
        assert!(!copy);
    }

    #[test]
    fn turns_a_bind_into_the_old_vm_into_a_copy_of_its_files() {
        let options = [("type", "none"), ("o", "bind"), ("device", "/home/ada/media")];
        let (request, copy) = recreation(&volume(&options));
        assert_eq!(request.driver_opts, Some(HashMap::new()));
        assert!(copy);
    }

    #[test]
    fn leaves_anonymous_volumes_to_their_containers() {
        assert!(is_anonymous("3f2a9c41d0e8aaaa3f2a9c41d0e8aaaa3f2a9c41d0e8aaaa3f2a9c41d0e8aaaa"));
        assert!(!is_anonymous("shop_pgdata"));
    }
}
