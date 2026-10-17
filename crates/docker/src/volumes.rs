use std::collections::HashMap;
use std::fs::File;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::pin::pin;

use bollard::body_full;
use bollard::models::VolumeCreateRequest;
use bollard::query_parameters::{
    DownloadFromContainerOptionsBuilder, ListContainersOptionsBuilder, PruneVolumesOptionsBuilder,
    RemoveVolumeOptionsBuilder, UploadToContainerOptionsBuilder,
};
use bytes::Bytes;
use flate2::Compression;
use flate2::write::GzEncoder;
use futures::StreamExt;
use serde::{Deserialize, Serialize};

use crate::helper::{Helper, inside_mount};
use crate::{Docker, Error, PruneReport, Result};

const COMPOSE_PROJECT: &str = "com.docker.compose.project";

/// A container using a volume, and where it sees it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VolumeUser {
    pub container_id: String,
    pub container: String,
    pub mounted_at: String,
    pub running: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VolumeSummary {
    pub name: String,
    pub driver: String,
    pub created_at: Option<String>,
    /// `None` while Docker hasn't measured it.
    #[specta(type = Option<specta_typescript::Number>)]
    pub size_bytes: Option<u64>,
    pub project: Option<String>,
    /// Created for a container without a name; a 64-character hash.
    pub anonymous: bool,
    pub used_by: Vec<VolumeUser>,
}

fn is_anonymous(name: &str) -> bool {
    name.len() == 64 && name.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn summarize(
    volume: bollard::models::Volume,
    users: &mut HashMap<String, Vec<VolumeUser>>,
) -> VolumeSummary {
    let size_bytes = volume.usage_data.and_then(|usage| u64::try_from(usage.size).ok());
    VolumeSummary {
        anonymous: is_anonymous(&volume.name),
        used_by: users.remove(&volume.name).unwrap_or_default(),
        project: volume.labels.get(COMPOSE_PROJECT).cloned(),
        created_at: volume.created_at,
        driver: volume.driver,
        name: volume.name,
        size_bytes,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum VolumeFileKind {
    File,
    Directory,
    Link,
    Other,
}

/// One entry of a folder inside a volume.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VolumeFile {
    pub name: String,
    pub kind: VolumeFileKind,
    #[specta(type = specta_typescript::Number)]
    pub size_bytes: u64,
    #[specta(type = specta_typescript::Number)]
    pub modified_at: i64,
}

/// Reads busybox `stat -c '%F|%s|%Y|%n'` lines, folders first, then by name.
fn parse_listing(output: &str) -> Vec<VolumeFile> {
    let mut entries: Vec<VolumeFile> = output
        .lines()
        .filter_map(|line| {
            let mut fields = line.splitn(4, '|');
            let (kind, size, modified, path) =
                (fields.next()?, fields.next()?, fields.next()?, fields.next()?);
            Some(VolumeFile {
                name: path.rsplit('/').next().unwrap_or(path).to_owned(),
                kind: match kind {
                    "directory" => VolumeFileKind::Directory,
                    "symbolic link" => VolumeFileKind::Link,
                    kind if kind.contains("regular") => VolumeFileKind::File,
                    _ => VolumeFileKind::Other,
                },
                size_bytes: size.parse().unwrap_or(0),
                modified_at: modified.parse().unwrap_or(0),
            })
        })
        .collect();
    entries.sort_by(|a, b| {
        (a.kind != VolumeFileKind::Directory, &a.name)
            .cmp(&(b.kind != VolumeFileKind::Directory, &b.name))
    });
    entries
}

const MOUNT: &str = "/v";

impl Docker {
    /// Every volume with its size and the containers that mount it.
    ///
    /// # Errors
    /// Fails when the engine can't be reached.
    pub async fn volumes(&self) -> Result<Vec<VolumeSummary>> {
        // bollard can't encode the `type` filter, so this measures images and containers too.
        let usage = self.api.df(None).await?;
        let raw: Vec<bollard::models::Volume> = usage
            .volume_usage
            .and_then(|usage| usage.items)
            .unwrap_or_default()
            .into_iter()
            .filter_map(|item| serde_json::from_value(item).ok())
            .collect();
        let mut users = self.volume_users().await?;
        let mut volumes: Vec<VolumeSummary> =
            raw.into_iter().map(|volume| summarize(volume, &mut users)).collect();
        volumes.sort_by(|a, b| (a.anonymous, &a.name).cmp(&(b.anonymous, &b.name)));
        Ok(volumes)
    }

    async fn volume_users(&self) -> Result<HashMap<String, Vec<VolumeUser>>> {
        let options = ListContainersOptionsBuilder::new().all(true).build();
        let mut users: HashMap<String, Vec<VolumeUser>> = HashMap::new();
        for container in self.api.list_containers(Some(options)).await? {
            let name = container.names.unwrap_or_default().into_iter().next().unwrap_or_default();
            let running =
                container.state == Some(bollard::models::ContainerSummaryStateEnum::RUNNING);
            for mount in container.mounts.unwrap_or_default() {
                if mount.typ.as_deref() != Some("volume") {
                    continue;
                }
                users.entry(mount.name.unwrap_or_default()).or_default().push(VolumeUser {
                    container_id: container.id.clone().unwrap_or_default(),
                    container: name.trim_start_matches('/').to_owned(),
                    mounted_at: mount.destination.unwrap_or_default(),
                    running,
                });
            }
        }
        Ok(users)
    }

    /// # Errors
    /// Fails when the name is taken or invalid.
    pub async fn create_volume(&self, name: &str) -> Result<()> {
        let request = VolumeCreateRequest { name: Some(name.to_owned()), ..Default::default() };
        self.api.create_volume(request).await?;
        Ok(())
    }

    /// # Errors
    /// Fails when a container still uses the volume.
    pub async fn remove_volume(&self, name: &str) -> Result<()> {
        let options = RemoveVolumeOptionsBuilder::new().force(false).build();
        Ok(self.api.remove_volume(name, Some(options)).await?)
    }

    /// Deletes every volume no container uses, named ones included.
    ///
    /// # Errors
    /// Fails when the engine refuses.
    pub async fn prune_volumes(&self) -> Result<PruneReport> {
        let filters = HashMap::from([("all", vec!["true"])]);
        let response = self
            .api
            .prune_volumes(Some(PruneVolumesOptionsBuilder::new().filters(&filters).build()))
            .await?;
        Ok(PruneReport::new(
            response.volumes_deleted.map_or(0, |deleted| deleted.len()),
            response.space_reclaimed,
        ))
    }

    /// Lists one folder of a volume, read-only, through a helper container.
    ///
    /// # Errors
    /// Fails when the folder doesn't exist or `path` leaves the volume.
    pub async fn volume_files(&self, name: &str, path: &str) -> Result<Vec<VolumeFile>> {
        let dir = inside_mount(MOUNT, path)?;
        let command = [
            "find",
            &dir,
            "-mindepth",
            "1",
            "-maxdepth",
            "1",
            "-exec",
            "stat",
            "-c",
            "%F|%s|%Y|%n",
            "{}",
            "+",
        ];
        let helper = Helper::create(self, vec![format!("{name}:{MOUNT}:ro")], &command).await?;
        let output = helper.run().await;
        helper.remove().await?;
        Ok(parse_listing(&output?))
    }

    /// Copies a file or folder out of a volume into `destination`, a folder on the Mac.
    ///
    /// # Errors
    /// Fails when the path doesn't exist or the folder can't be written.
    pub async fn download_from_volume(
        &self,
        name: &str,
        path: &str,
        destination: &Path,
    ) -> Result<PathBuf> {
        let source = inside_mount(MOUNT, path)?;
        let archive = tempfile::NamedTempFile::new()?;
        self.save_archive(name, &source, archive.as_file().try_clone()?).await?;
        tar::Archive::new(File::open(archive.path())?).unpack(destination)?;
        Ok(destination.join(source.rsplit('/').next().unwrap_or(name)))
    }

    /// Writes the whole volume to `destination` as a `.tar.gz`.
    ///
    /// # Errors
    /// Fails when the volume can't be read or the file can't be written.
    pub async fn backup_volume(&self, name: &str, destination: &Path) -> Result<()> {
        let mut gzip = GzEncoder::new(File::create(destination)?, Compression::default());
        self.save_archive(name, MOUNT, &mut gzip).await?;
        gzip.finish()?;
        Ok(())
    }

    /// Creates `target` with a copy of every file in `source`.
    ///
    /// # Errors
    /// Fails when `target` exists or the copy fails.
    pub async fn clone_volume(&self, source: &str, target: &str) -> Result<()> {
        self.create_volume(target).await?;
        let binds = vec![format!("{source}:/from:ro"), format!("{target}:/to")];
        let helper = Helper::create(self, binds, &["cp", "-a", "/from/.", "/to/"]).await?;
        let copied = helper.run().await;
        helper.remove().await?;
        copied.map(drop)
    }

    /// Puts a backup's files into `name`, creating the volume when it doesn't exist. With
    /// `replace`, what the volume held is deleted first. Takes Containeria's own backups and plain
    /// `.tar` or `.tar.gz` archives of a volume's contents.
    ///
    /// # Errors
    /// Fails when the file isn't a tar archive or the volume can't be written.
    pub async fn restore_volume(&self, name: &str, source: &Path, replace: bool) -> Result<()> {
        let source = source.to_path_buf();
        let (bytes, ours) = tokio::task::spawn_blocking(move || -> Result<(Vec<u8>, bool)> {
            let bytes = std::fs::read(&source)?;
            let ours = is_containeria_backup(&bytes)?;
            Ok((bytes, ours))
        })
        .await
        .map_err(|error| Error::Engine(error.to_string()))??;
        if self.api.inspect_volume(name).await.is_err() {
            self.create_volume(name).await?;
        } else if replace {
            let binds = vec![format!("{name}:{MOUNT}")];
            let wipe = format!("find {MOUNT} -mindepth 1 -maxdepth 1 -exec rm -rf {{}} +");
            let helper = Helper::create(self, binds, &["sh", "-c", &wipe]).await?;
            let wiped = helper.run().await;
            helper.remove().await?;
            wiped?;
        }
        let helper = Helper::create(self, vec![format!("{name}:{MOUNT}")], &["true"]).await?;
        let target = if ours { "/" } else { MOUNT };
        let options = UploadToContainerOptionsBuilder::new().path(target).build();
        let uploaded = self
            .api
            .upload_to_container(&helper.id, Some(options), body_full(Bytes::from(bytes)))
            .await;
        helper.remove().await?;
        Ok(uploaded?)
    }

    /// Writes on the async runtime; move to `spawn_blocking` if large backups ever stall other tasks.
    async fn save_archive(&self, volume: &str, path: &str, mut writer: impl Write) -> Result<()> {
        let helper = Helper::create(self, vec![format!("{volume}:{MOUNT}:ro")], &["true"]).await?;
        let options = DownloadFromContainerOptionsBuilder::new().path(path).build();
        let mut chunks = pin!(self.api.download_from_container(&helper.id, Some(options)));
        let mut written = Ok(());
        while let Some(chunk) = chunks.next().await {
            if let Err(error) =
                chunk.map_err(Error::from).and_then(|bytes| Ok(writer.write_all(&bytes)?))
            {
                written = Err(error);
                break;
            }
        }
        helper.remove().await?;
        written
    }
}

/// Whether every entry sits under the `v/` folder Containeria's backups use; other archives hold
/// a volume's files at their top level. Takes `.tar` and `.tar.gz`.
fn is_containeria_backup(bytes: &[u8]) -> Result<bool> {
    let gzip = bytes.starts_with(&[0x1f, 0x8b]);
    let reader: Box<dyn std::io::Read> =
        if gzip { Box::new(flate2::read::GzDecoder::new(bytes)) } else { Box::new(bytes) };
    let prefix = MOUNT.trim_start_matches('/');
    let mut archive = tar::Archive::new(reader);
    let mut any = false;
    for entry in archive.entries().map_err(|_| not_an_archive())? {
        let entry = entry.map_err(|_| not_an_archive())?;
        let path = entry.path().map_err(|_| not_an_archive())?.into_owned();
        let first = path.components().next().map(|part| part.as_os_str().to_owned());
        if first.as_deref() != Some(std::ffi::OsStr::new(prefix)) {
            return Ok(false);
        }
        any = true;
    }
    if any { Ok(true) } else { Err(not_an_archive()) }
}

fn not_an_archive() -> Error {
    Error::Engine("That file isn't a .tar or .tar.gz archive.".to_owned())
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::*;

    fn archive(paths: &[&str], gzip: bool) -> Vec<u8> {
        let mut builder = tar::Builder::new(Vec::new());
        for path in paths {
            let mut header = tar::Header::new_gnu();
            header.set_size(2);
            header.set_mode(0o644);
            header.set_cksum();
            builder.append_data(&mut header, path, &b"hi"[..]).unwrap();
        }
        let tar = builder.into_inner().unwrap();
        if !gzip {
            return tar;
        }
        let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
        encoder.write_all(&tar).unwrap();
        encoder.finish().unwrap()
    }

    #[test]
    fn tells_its_own_backups_from_plain_archives() {
        assert!(is_containeria_backup(&archive(&["v/PG_VERSION", "v/base/1"], true)).unwrap());
        assert!(!is_containeria_backup(&archive(&["PG_VERSION", "base/1"], false)).unwrap());
        assert!(!is_containeria_backup(&archive(&["./PG_VERSION"], true)).unwrap());
        assert!(is_containeria_backup(b"not a tar at all, just text").is_err());
    }

    #[test]
    fn reads_a_busybox_listing_folders_first() {
        let output = "regular file|1024|1760000000|/v/pg/PG_VERSION\n\
                      directory|4096|1760000100|/v/pg/base\n\
                      symbolic link|7|1760000200|/v/pg/current\n\
                      regular empty file|0|1760000300|/v/pg/a|b";
        let entries = parse_listing(output);
        let names: Vec<_> = entries.iter().map(|entry| (entry.name.as_str(), entry.kind)).collect();
        assert_eq!(
            names,
            [
                ("base", VolumeFileKind::Directory),
                ("PG_VERSION", VolumeFileKind::File),
                ("a|b", VolumeFileKind::File),
                ("current", VolumeFileKind::Link)
            ]
        );
        assert_eq!(entries[1].size_bytes, 1024);
        assert_eq!(entries[1].modified_at, 1_760_000_000);
    }

    #[test]
    fn spots_anonymous_volumes() {
        assert!(is_anonymous(&"a1".repeat(32)));
        assert!(!is_anonymous("shop_pgdata"));
    }

    #[test]
    fn summarizes_size_project_and_users() {
        let volume = bollard::models::Volume {
            name: "shop_pgdata".into(),
            driver: "local".into(),
            labels: HashMap::from([(COMPOSE_PROJECT.to_owned(), "shop".to_owned())]),
            usage_data: Some(bollard::models::VolumeUsageData { size: 2_048, ref_count: 1 }),
            ..Default::default()
        };
        let user = VolumeUser {
            container_id: "c1".into(),
            container: "shop-db-1".into(),
            mounted_at: "/var/lib/postgresql/data".into(),
            running: true,
        };
        let mut users = HashMap::from([("shop_pgdata".to_owned(), vec![user.clone()])]);
        let summary = summarize(volume, &mut users);
        assert_eq!(summary.size_bytes, Some(2_048));
        assert_eq!(summary.project.as_deref(), Some("shop"));
        assert_eq!(summary.used_by, vec![user]);
    }

    #[test]
    fn an_unmeasured_volume_has_no_size() {
        let volume = bollard::models::Volume {
            name: "cache".into(),
            usage_data: Some(bollard::models::VolumeUsageData { size: -1, ref_count: -1 }),
            ..Default::default()
        };
        assert_eq!(summarize(volume, &mut HashMap::new()).size_bytes, None);
    }
}
