use std::collections::HashMap;

use bollard::models::{
    ContainerCreateBody, ContainerInspectResponse, HostConfig, NetworkingConfig, PortBinding,
    RestartPolicy, RestartPolicyNameEnum,
};
use bollard::query_parameters::{
    CommitContainerOptionsBuilder, CreateContainerOptionsBuilder, CreateImageOptionsBuilder,
    InspectContainerOptions, RemoveContainerOptionsBuilder, RenameContainerOptionsBuilder,
    StartContainerOptions, StopContainerOptions,
};
use futures::TryStreamExt;
use serde::{Deserialize, Serialize};

use crate::containers::PortProtocol;
use crate::details::EnvVar;
use crate::images::pull_parts;
use crate::{Docker, Error, Result};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum Restart {
    No,
    OnFailure,
    #[default]
    UnlessStopped,
    Always,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PortMapping {
    pub host: u16,
    pub container: u16,
    pub protocol: PortProtocol,
}

/// A volume by name, or a folder on the Mac by absolute path.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct StorageMapping {
    pub source: String,
    pub target: String,
    pub read_only: bool,
}

/// What the Run container sheet asks for.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RunSpec {
    pub image: String,
    pub name: Option<String>,
    pub ports: Vec<PortMapping>,
    pub env: Vec<EnvVar>,
    pub storage: Vec<StorageMapping>,
    pub restart: Restart,
    /// Replaces the image's default command when set, already split into arguments.
    pub command: Option<Vec<String>>,
    /// `linux/amd64` to run an Intel image under Rosetta or QEMU.
    pub platform: Option<String>,
}

/// A Docker Hub search result.
fn protocol_name(protocol: PortProtocol) -> &'static str {
    match protocol {
        PortProtocol::Tcp => "tcp",
        PortProtocol::Udp => "udp",
        PortProtocol::Sctp => "sctp",
    }
}

fn restart_policy(restart: Restart) -> RestartPolicy {
    let name = match restart {
        Restart::No => RestartPolicyNameEnum::NO,
        Restart::OnFailure => RestartPolicyNameEnum::ON_FAILURE,
        Restart::UnlessStopped => RestartPolicyNameEnum::UNLESS_STOPPED,
        Restart::Always => RestartPolicyNameEnum::ALWAYS,
    };
    RestartPolicy { name: Some(name), maximum_retry_count: None }
}

/// Docker's create body for a run spec: ports become exposed ports plus bindings, storage
/// becomes `source:target[:ro]` binds.
fn create_body(spec: &RunSpec) -> ContainerCreateBody {
    let mut bindings: HashMap<String, Option<Vec<PortBinding>>> = HashMap::new();
    for port in &spec.ports {
        let key = format!("{}/{}", port.container, protocol_name(port.protocol));
        let binding = PortBinding { host_ip: None, host_port: Some(port.host.to_string()) };
        bindings.entry(key).or_default().get_or_insert_with(Vec::new).push(binding);
    }
    let mut exposed: Vec<String> = bindings.keys().cloned().collect();
    exposed.sort();
    let binds = spec
        .storage
        .iter()
        .map(|storage| {
            let mode = if storage.read_only { ":ro" } else { "" };
            format!("{}:{}{mode}", storage.source, storage.target)
        })
        .collect();
    ContainerCreateBody {
        image: Some(spec.image.clone()),
        env: Some(spec.env.iter().map(|var| format!("{}={}", var.key, var.value)).collect()),
        cmd: spec.command.clone(),
        exposed_ports: Some(exposed),
        host_config: Some(HostConfig {
            port_bindings: Some(bindings),
            binds: Some(binds),
            restart_policy: Some(restart_policy(spec.restart)),
            ..HostConfig::default()
        }),
        ..ContainerCreateBody::default()
    }
}

impl Docker {
    /// Pulls the image unless it's already here, creates the container and starts it.
    ///
    /// # Errors
    /// Fails when the image can't be pulled, the name is taken or a port is already in use.
    pub async fn run(&self, spec: &RunSpec) -> Result<String> {
        let image = spec.image.trim();
        if image.is_empty() {
            return Err(Error::Engine("Choose an image to run.".to_owned()));
        }
        self.ensure_image(image).await?;
        let mut options = CreateContainerOptionsBuilder::new();
        if let Some(name) = spec.name.as_deref().filter(|name| !name.is_empty()) {
            options = options.name(name);
        }
        if let Some(platform) = spec.platform.as_deref() {
            options = options.platform(platform);
        }
        let created = self.api.create_container(Some(options.build()), create_body(spec)).await?;
        self.api.start_container(&created.id, None::<StartContainerOptions>).await?;
        Ok(created.id)
    }

    /// Pulls `reference` if no local image has that name.
    pub(crate) async fn ensure_image(&self, reference: &str) -> Result<()> {
        if self.api.inspect_image(reference).await.is_ok() {
            return Ok(());
        }
        let (repo, tag) = pull_parts(reference);
        let options = CreateImageOptionsBuilder::new().from_image(&repo).tag(&tag).build();
        self.api.create_image(Some(options), None, None).try_collect::<Vec<_>>().await?;
        Ok(())
    }

    /// # Errors
    /// Fails when the name is taken.
    pub async fn rename(&self, id: &str, name: &str) -> Result<()> {
        let options = RenameContainerOptionsBuilder::new().name(name).build();
        Ok(self.api.rename_container(id, options).await?)
    }

    /// Saves the container's current filesystem as a new image `reference`.
    ///
    /// # Errors
    /// Fails when the container is gone or the reference is invalid.
    pub async fn commit(&self, id: &str, reference: &str) -> Result<String> {
        let (repo, tag) = pull_parts(reference);
        let options = CommitContainerOptionsBuilder::new()
            .container(id)
            .repo(&repo)
            .tag(&tag)
            .pause(true)
            .build();
        let committed =
            self.api.commit_container(options, bollard::models::ContainerConfig::default()).await?;
        Ok(committed.id)
    }
}

/// The settings to create the same container again. Anonymous volumes become named binds so the
/// new container keeps their data; a hostname Docker derived from the old ID is dropped.
pub(crate) fn recreate_body(inspect: ContainerInspectResponse) -> Result<ContainerCreateBody> {
    let id = inspect.id.unwrap_or_default();
    let config =
        inspect.config.ok_or_else(|| Error::Engine("the container has no settings".to_owned()))?;
    let mut body: ContainerCreateBody =
        serde_json::to_value(config).and_then(serde_json::from_value).map_err(|error| {
            Error::Engine(format!("the container's settings can't be copied: {error}"))
        })?;
    if body.hostname.as_deref().is_some_and(|hostname| id.starts_with(hostname)) {
        body.hostname = None;
    }
    let mut host = inspect.host_config.unwrap_or_default();
    let anonymous = inspect.mounts.unwrap_or_default().into_iter().filter_map(|mount| {
        let named = mount.typ.as_deref() == Some("volume");
        Some(format!("{}:{}", mount.name.filter(|_| named)?, mount.destination?))
    });
    let mut binds = host.binds.take().unwrap_or_default();
    for bind in anonymous {
        let target = bind.split(':').nth(1).unwrap_or_default().to_owned();
        if !binds.iter().any(|existing| existing.split(':').nth(1) == Some(target.as_str())) {
            binds.push(bind);
        }
    }
    host.binds = Some(binds);
    body.host_config = Some(host);
    let networks = inspect.network_settings.and_then(|settings| settings.networks);
    body.networking_config = networks.map(|networks| NetworkingConfig {
        endpoints_config: Some(
            networks
                .into_iter()
                .map(|(name, endpoint)| {
                    let kept = bollard::models::EndpointSettings {
                        ipam_config: endpoint.ipam_config,
                        aliases: endpoint.aliases,
                        driver_opts: endpoint.driver_opts,
                        ..Default::default()
                    };
                    (name, kept)
                })
                .collect(),
        ),
    });
    Ok(body)
}

impl Docker {
    /// Creates the container again from its own settings, keeping its name, ports, volumes and
    /// networks. With `pull`, a newer image is fetched first. The old container is only removed
    /// once the new one exists.
    ///
    /// # Errors
    /// Fails when the container is gone or the new one can't be created; the old one then stays.
    pub async fn recreate(&self, id: &str, pull: bool) -> Result<String> {
        let inspect = self.api.inspect_container(id, None::<InspectContainerOptions>).await?;
        let name = inspect.name.clone().unwrap_or_default().trim_start_matches('/').to_owned();
        let running = inspect.state.as_ref().and_then(|state| state.running).unwrap_or(false);
        let image =
            inspect.config.as_ref().and_then(|config| config.image.clone()).unwrap_or_default();
        if pull {
            let (repo, tag) = pull_parts(&image);
            let options = CreateImageOptionsBuilder::new().from_image(&repo).tag(&tag).build();
            self.api.create_image(Some(options), None, None).try_collect::<Vec<_>>().await?;
        }
        let body = recreate_body(inspect)?;
        let aside = format!("{name}-replaced");
        if running {
            self.api.stop_container(id, None::<StopContainerOptions>).await?;
        }
        self.rename(id, &aside).await?;
        let options = CreateContainerOptionsBuilder::new().name(&name).build();
        let created = match self.api.create_container(Some(options), body).await {
            Ok(created) => created,
            Err(error) => {
                self.rename(id, &name).await?;
                if running {
                    self.api.start_container(id, None::<StartContainerOptions>).await?;
                }
                return Err(error.into());
            }
        };
        let options = RemoveContainerOptionsBuilder::new().force(true).v(false).build();
        self.api.remove_container(id, Some(options)).await?;
        if running {
            self.api.start_container(&created.id, None::<StartContainerOptions>).await?;
        }
        Ok(created.id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recreates_with_the_same_settings_and_keeps_anonymous_volumes() {
        let inspect: ContainerInspectResponse = serde_json::from_value(serde_json::json!({
            "Id": "3f2a9c41d0e8aaaa",
            "Name": "/shop-db-1",
            "Config": {"Hostname": "3f2a9c41d0e8", "Image": "postgres:18", "Env": ["A=1"]},
            "HostConfig": {"Binds": ["/Users/ada/seed:/seed"], "PortBindings": {"5432/tcp": [{"HostPort": "5433"}]}},
            "Mounts": [
                {"Type": "volume", "Name": "a1b2c3", "Destination": "/var/lib/postgresql"},
                {"Type": "bind", "Source": "/Users/ada/seed", "Destination": "/seed"}
            ],
            "NetworkSettings": {"Networks": {"shop_default": {"Aliases": ["db"], "IPAddress": "172.18.0.2"}}}
        }))
        .unwrap();
        let body = recreate_body(inspect).unwrap();
        assert_eq!(body.hostname, None);
        assert_eq!(body.image.as_deref(), Some("postgres:18"));
        let binds = body.host_config.unwrap().binds.unwrap();
        assert_eq!(binds, ["/Users/ada/seed:/seed", "a1b2c3:/var/lib/postgresql"]);
        let endpoints = body.networking_config.unwrap().endpoints_config.unwrap();
        let endpoint = &endpoints["shop_default"];
        assert_eq!(endpoint.aliases.as_deref(), Some(&["db".to_owned()][..]));
        assert_eq!(endpoint.ip_address, None);
    }

    fn spec() -> RunSpec {
        RunSpec {
            image: "postgres:18".to_owned(),
            name: Some("db".to_owned()),
            ports: vec![
                PortMapping { host: 5433, container: 5432, protocol: PortProtocol::Tcp },
                PortMapping { host: 15432, container: 5432, protocol: PortProtocol::Tcp },
            ],
            env: vec![EnvVar { key: "POSTGRES_PASSWORD".to_owned(), value: "a=b".to_owned() }],
            storage: vec![
                StorageMapping {
                    source: "pg".to_owned(),
                    target: "/var/lib/postgresql".to_owned(),
                    read_only: false,
                },
                StorageMapping {
                    source: "/Users/ada/seed".to_owned(),
                    target: "/seed".to_owned(),
                    read_only: true,
                },
            ],
            restart: Restart::OnFailure,
            command: None,
            platform: None,
        }
    }

    #[test]
    fn maps_ports_env_storage_and_restart() {
        let body = create_body(&spec());
        let host = body.host_config.unwrap();
        let bindings = host.port_bindings.unwrap();
        let hosts: Vec<_> = bindings["5432/tcp"]
            .as_ref()
            .unwrap()
            .iter()
            .map(|b| b.host_port.clone().unwrap())
            .collect();
        assert_eq!(hosts, ["5433", "15432"]);
        assert_eq!(body.exposed_ports.unwrap(), ["5432/tcp"]);
        assert_eq!(body.env.unwrap(), ["POSTGRES_PASSWORD=a=b"]);
        assert_eq!(host.binds.unwrap(), ["pg:/var/lib/postgresql", "/Users/ada/seed:/seed:ro"]);
        assert_eq!(host.restart_policy.unwrap().name, Some(RestartPolicyNameEnum::ON_FAILURE));
    }
}
