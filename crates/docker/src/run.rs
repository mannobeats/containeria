use std::collections::HashMap;

use bollard::models::{
    ContainerCreateBody, HostConfig, PortBinding, RestartPolicy, RestartPolicyNameEnum,
};
use bollard::query_parameters::{
    CommitContainerOptionsBuilder, CreateContainerOptionsBuilder, CreateImageOptionsBuilder,
    RenameContainerOptionsBuilder, SearchImagesOptionsBuilder, StartContainerOptions,
};
use futures::TryStreamExt;
use serde::{Deserialize, Serialize};

use crate::containers::PortProtocol;
use crate::details::EnvVar;
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
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct HubImage {
    pub name: String,
    pub description: String,
    pub official: bool,
    pub stars: u32,
}

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

/// `nginx:1.29` → (`nginx`, `1.29`); a registry port isn't a tag; no tag means `latest`.
fn split_reference(reference: &str) -> (&str, &str) {
    match reference.rsplit_once(':') {
        Some((repo, tag)) if !tag.contains('/') => (repo, tag),
        _ => (reference, "latest"),
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
        let (repo, tag) = split_reference(reference);
        let options = CreateImageOptionsBuilder::new().from_image(repo).tag(tag).build();
        self.api.create_image(Some(options), None, None).try_collect::<Vec<_>>().await?;
        Ok(())
    }

    /// Docker Hub, through the engine's own search endpoint.
    ///
    /// # Errors
    /// Fails when the engine can't reach Docker Hub.
    pub async fn search_hub(&self, term: &str) -> Result<Vec<HubImage>> {
        let options = SearchImagesOptionsBuilder::new().term(term).limit(12).build();
        let mut images: Vec<HubImage> = self
            .api
            .search_images(options)
            .await?
            .into_iter()
            .map(|item| HubImage {
                name: item.name.unwrap_or_default(),
                description: item.description.unwrap_or_default(),
                official: item.is_official.unwrap_or(false),
                stars: item.star_count.and_then(|stars| u32::try_from(stars).ok()).unwrap_or(0),
            })
            .collect();
        images.sort_by_key(|image| (!image.official, std::cmp::Reverse(image.stars)));
        Ok(images)
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
        let (repo, tag) = split_reference(reference);
        let options = CommitContainerOptionsBuilder::new()
            .container(id)
            .repo(repo)
            .tag(tag)
            .pause(true)
            .build();
        let committed =
            self.api.commit_container(options, bollard::models::ContainerConfig::default()).await?;
        Ok(committed.id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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

    #[test]
    fn splits_image_references() {
        assert_eq!(split_reference("nginx"), ("nginx", "latest"));
        assert_eq!(split_reference("postgres:18-alpine"), ("postgres", "18-alpine"));
        assert_eq!(split_reference("localhost:5000/app"), ("localhost:5000/app", "latest"));
        assert_eq!(split_reference("localhost:5000/app:v2"), ("localhost:5000/app", "v2"));
    }
}
