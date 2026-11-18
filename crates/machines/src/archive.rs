//! A machine as one file: its whole disk, to keep or to move to another Mac.

use std::path::Path;

use bollard::models::ContainerCreateBody;
use bollard::query_parameters::{
    CreateContainerOptionsBuilder, CreateImageOptionsBuilder, InspectContainerOptions,
    LogsOptionsBuilder, StartContainerOptions, WaitContainerOptions,
};
use futures::{StreamExt, TryStreamExt};
use serde::Deserialize;
use tokio::io::AsyncWriteExt;
use tokio_util::io::ReaderStream;

use crate::machine::{Shape, container};
use crate::name::validate_name;
use crate::provision;
use crate::snapshot::own_image;
use crate::{Error, Machines, Result};

/// What a machine recorded about itself in `/etc/containeria-machine.json`.
#[derive(Debug, Default, Deserialize)]
#[serde(default)]
struct Recorded {
    distro: String,
    release: String,
    user: String,
}

fn file_error(path: &Path) -> impl FnOnce(std::io::Error) -> Error {
    let path = path.display().to_string();
    move |source| Error::File { path, source }
}

impl Machines {
    /// Writes the machine's disk to `destination` as a tar archive, without its snapshots.
    ///
    /// # Errors
    /// Fails when the machine doesn't exist or the file can't be written.
    pub async fn export(&self, machine: &str, destination: &Path) -> Result<()> {
        validate_name(machine)?;
        let name = container(machine);
        self.api.inspect_container(&name, None::<InspectContainerOptions>).await?;
        let mut file =
            tokio::fs::File::create(destination).await.map_err(file_error(destination))?;
        let mut chunks = std::pin::pin!(self.api.export_container(&name));
        while let Some(chunk) = chunks.next().await {
            file.write_all(&chunk?).await.map_err(file_error(destination))?;
        }
        file.flush().await.map_err(file_error(destination))
    }

    /// Makes a stopped machine named `name` from an archive [`Self::export`] wrote, plain or
    /// gzipped. It keeps the distribution and user it was exported with.
    ///
    /// # Errors
    /// Fails when the name is taken or invalid, or the file isn't an archive of a disk.
    pub async fn import(&self, name: &str, source: &Path) -> Result<()> {
        validate_name(name)?;
        if self
            .api
            .inspect_container(&container(name), None::<InspectContainerOptions>)
            .await
            .is_ok()
        {
            return Err(Error::Invalid(format!("A machine named {name} already exists.")));
        }
        let file = tokio::fs::File::open(source).await.map_err(file_error(source))?;
        let image = own_image(name);
        let (repository, tag) = image.split_once(':').unwrap_or((&image, "latest"));
        let options =
            CreateImageOptionsBuilder::new().from_src("-").repo(repository).tag(tag).build();
        let disk = bollard::body_try_stream(ReaderStream::new(file));
        self.api.create_image(Some(options), Some(disk), None).try_collect::<Vec<_>>().await?;
        let recorded = self.recorded(&image).await;
        let family = crate::Distro::find(&recorded.distro).map(|distro| distro.family);
        let shape = Shape {
            name: name.to_owned(),
            distro: recorded.distro,
            release: recorded.release,
            user: if recorded.user.is_empty() { "root".to_owned() } else { recorded.user },
            init: family.map_or("/sbin/init", provision::init).to_owned(),
            stop_signal: family.map_or("SIGRTMIN+3", provision::stop_signal).to_owned(),
            cpus: 2,
            memory_gib: 4,
            home: None,
        };
        self.create_container(&shape, &image).await
    }

    /// Reads what the disk in `image` says it is, with a container that only prints the file.
    /// A disk that says nothing imports as a machine of an unknown distribution.
    async fn recorded(&self, image: &str) -> Recorded {
        let name =
            format!("containeria-machine-import-{}", image.rsplit(':').next().unwrap_or("x"));
        let _ = self.remove(&name).await;
        let body = ContainerCreateBody {
            image: Some(image.to_owned()),
            cmd: Some(["cat", "/etc/containeria-machine.json"].map(str::to_owned).into()),
            ..ContainerCreateBody::default()
        };
        let read = async {
            let options = CreateContainerOptionsBuilder::new().name(&name).build();
            self.api.create_container(Some(options), body).await?;
            self.api.start_container(&name, None::<StartContainerOptions>).await?;
            let waiting = self.api.wait_container(&name, None::<WaitContainerOptions>);
            waiting.try_collect::<Vec<_>>().await?;
            let options = LogsOptionsBuilder::new().stdout(true).build();
            let printed = self.api.logs(&name, Some(options)).try_collect::<Vec<_>>().await?;
            let text: String = printed.iter().map(ToString::to_string).collect();
            Ok::<_, Error>(serde_json::from_str(&text).unwrap_or_default())
        };
        let recorded = read.await.unwrap_or_default();
        let _ = self.remove(&name).await;
        recorded
    }
}
