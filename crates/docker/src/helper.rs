use std::collections::HashMap;
use std::pin::pin;

use bollard::container::LogOutput;
use bollard::models::{ContainerCreateBody, HostConfig};
use bollard::query_parameters::{
    CreateContainerOptionsBuilder, CreateImageOptionsBuilder, LogsOptionsBuilder,
    RemoveContainerOptionsBuilder, StartContainerOptions, WaitContainerOptions,
};
use futures::{StreamExt, TryStreamExt};

use crate::{Docker, Error, Result};

/// Small and multi-arch; it carries `find`, `stat` and `cp`, which is all the helpers need.
const IMAGE: &str = "busybox:1.37";
const LABEL: &str = "dev.containeria.helper";

/// A short-lived, network-less busybox container used to reach into volumes. Always removed.
#[derive(Debug)]
pub(crate) struct Helper<'a> {
    docker: &'a Docker,
    pub(crate) id: String,
}

impl<'a> Helper<'a> {
    /// Creates (but doesn't start) a helper with `binds` (`volume:/path[:ro]`) running `command`.
    pub(crate) async fn create(
        docker: &'a Docker,
        binds: Vec<String>,
        command: &[&str],
    ) -> Result<Self> {
        Self::create_from(docker, IMAGE, false, binds, command).await
    }

    /// A helper from another image, pulled first if it isn't there; `network` lets it download.
    pub(crate) async fn create_from(
        docker: &'a Docker,
        image: &str,
        network: bool,
        binds: Vec<String>,
        command: &[&str],
    ) -> Result<Self> {
        if docker.api.inspect_image(image).await.is_err() {
            let options = CreateImageOptionsBuilder::new().from_image(image).build();
            docker.api.create_image(Some(options), None, None).try_collect::<Vec<_>>().await?;
        }
        let body = ContainerCreateBody {
            image: Some(image.to_owned()),
            cmd: Some(command.iter().map(|part| (*part).to_owned()).collect()),
            network_disabled: Some(!network),
            labels: Some(HashMap::from([(LABEL.to_owned(), "true".to_owned())])),
            host_config: Some(HostConfig { binds: Some(binds), ..Default::default() }),
            ..Default::default()
        };
        let options = CreateContainerOptionsBuilder::new().build();
        let id = docker.api.create_container(Some(options), body).await?.id;
        Ok(Self { docker, id })
    }

    /// Runs the helper to completion and returns its standard output.
    pub(crate) async fn run(&self) -> Result<String> {
        let api = &self.docker.api;
        api.start_container(&self.id, None::<StartContainerOptions>).await?;
        let mut waiting = pin!(api.wait_container(&self.id, None::<WaitContainerOptions>));
        let exit = waiting.next().await.transpose();
        let options = LogsOptionsBuilder::new().stdout(true).stderr(true).build();
        let mut stdout = String::new();
        let mut stderr = String::new();
        let mut logs = pin!(api.logs(&self.id, Some(options)));
        while let Some(chunk) = logs.next().await.transpose()? {
            let target =
                if matches!(chunk, LogOutput::StdErr { .. }) { &mut stderr } else { &mut stdout };
            target.push_str(&String::from_utf8_lossy(&chunk.into_bytes()));
        }
        if matches!(exit, Ok(Some(ref response)) if response.status_code == 0) {
            return Ok(stdout);
        }
        let reason = stderr.trim();
        Err(Error::Engine(if reason.is_empty() {
            "the helper container failed".to_owned()
        } else {
            reason.to_owned()
        }))
    }

    pub(crate) async fn remove(self) -> Result<()> {
        let options = RemoveContainerOptionsBuilder::new().force(true).v(false).build();
        Ok(self.docker.api.remove_container(&self.id, Some(options)).await?)
    }
}

/// `docs/../x` → error; `/pg/base/` → `/v/pg/base`. Keeps a helper path inside the mounted volume.
pub(crate) fn inside_mount(mount: &str, path: &str) -> Result<String> {
    let parts: Vec<&str> =
        path.split('/').filter(|part| !part.is_empty() && *part != ".").collect();
    if parts.contains(&"..") {
        return Err(Error::Engine(format!("{path} leaves the volume")));
    }
    Ok(if parts.is_empty() { mount.to_owned() } else { format!("{mount}/{}", parts.join("/")) })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_paths_inside_the_mount() {
        assert_eq!(inside_mount("/v", "").unwrap(), "/v");
        assert_eq!(inside_mount("/v", "/pg/./base/").unwrap(), "/v/pg/base");
        assert!(inside_mount("/v", "pg/../../etc").is_err());
    }
}
