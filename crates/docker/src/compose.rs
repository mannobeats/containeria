//! Docker Compose, run as its own CLI against Containeria's engine. Compose is a large spec (builds,
//! profiles, env files, healthcheck ordering); running the real tool keeps every project working the
//! way it does with Docker Desktop.

use std::collections::{BTreeMap, HashMap};
use std::env;
use std::ffi::OsString;
use std::path::{Path, PathBuf};

use bollard::query_parameters::ListContainersOptionsBuilder;
use serde::{Deserialize, Serialize};
use tokio::process::Command;

use crate::cli;
use crate::containers::COMPOSE_PROJECT;
use crate::{Docker, Error, Result};

const CONFIG_FILES: &str = "com.docker.compose.project.config_files";
const WORKING_DIR: &str = "com.docker.compose.project.working_dir";

/// Where Homebrew and Docker's own installers put the Compose plugin, on Apple silicon and Intel.
const PLUGIN_DIRS: [&str; 2] =
    ["/opt/homebrew/lib/docker/cli-plugins", "/usr/local/lib/docker/cli-plugins"];

/// A project's definition: its files, and the folder relative paths in them start from.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ComposeFiles {
    pub files: Vec<PathBuf>,
    pub directory: Option<PathBuf>,
}

/// What a deploy will create, read from the files before anything runs.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ComposePreview {
    pub name: String,
    pub services: Vec<ComposeService>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ComposeService {
    pub name: String,
    /// The image it runs, or the one a build produces.
    pub image: Option<String>,
    pub builds: bool,
    /// Published ports as `host:container`.
    pub ports: Vec<String>,
}

#[derive(Deserialize)]
struct RawConfig {
    name: String,
    #[serde(default)]
    services: BTreeMap<String, RawService>,
}

#[derive(Deserialize)]
struct RawService {
    image: Option<String>,
    build: Option<serde_json::Value>,
    #[serde(default)]
    ports: Vec<RawPort>,
}

#[derive(Deserialize)]
struct RawPort {
    target: u16,
    published: Option<String>,
}

impl From<RawConfig> for ComposePreview {
    fn from(raw: RawConfig) -> Self {
        let services = raw
            .services
            .into_iter()
            .map(|(name, service)| ComposeService {
                name,
                image: service.image,
                builds: service.build.is_some(),
                ports: service
                    .ports
                    .into_iter()
                    .map(|port| match port.published {
                        Some(host) => format!("{host}:{}", port.target),
                        None => port.target.to_string(),
                    })
                    .collect(),
            })
            .collect();
        Self { name: raw.name, services }
    }
}

/// What can be done to a whole project.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum ComposeVerb {
    /// Creates what's missing and recreates what changed.
    Up,
    /// Builds images again and recreates every container.
    Rebuild,
    /// Pulls newer images, then recreates the containers they changed.
    Pull,
    /// Removes the containers and networks; volumes stay.
    Down,
    /// Removes the containers, networks and the project's named volumes.
    DownWithVolumes,
}

impl ComposeVerb {
    fn args(self) -> &'static [&'static str] {
        match self {
            Self::Up => &["up", "--detach", "--remove-orphans"],
            Self::Rebuild => &["up", "--detach", "--build", "--force-recreate", "--remove-orphans"],
            Self::Pull => &["pull"],
            Self::Down => &["down", "--remove-orphans"],
            Self::DownWithVolumes => &["down", "--remove-orphans", "--volumes"],
        }
    }
}

/// Compose names: lowercase letters, digits, dashes and underscores, starting with a letter or digit.
#[must_use]
pub fn is_project_name(name: &str) -> bool {
    let mut chars = name.chars();
    chars.next().is_some_and(|first| first.is_ascii_lowercase() || first.is_ascii_digit())
        && chars.all(|char| {
            char.is_ascii_lowercase() || char.is_ascii_digit() || char == '-' || char == '_'
        })
}

/// A folder or file name made into a valid project name, as Compose does for a folder.
#[must_use]
pub fn project_name_from(name: &str) -> String {
    let cleaned: String = name
        .to_lowercase()
        .chars()
        .filter(|char| char.is_ascii_alphanumeric() || *char == '-' || *char == '_')
        .collect();
    cleaned.trim_start_matches(['-', '_']).to_owned()
}

#[derive(Debug, Clone)]
pub struct Compose {
    bin: PathBuf,
    socket: PathBuf,
}

impl Compose {
    /// Finds Compose: `$CONTAINERIA_COMPOSE`, the copy bundled with the app, the Docker CLI
    /// plugin, then `docker-compose` on the `PATH`.
    #[must_use]
    pub fn locate(socket: &Path, bundled: Option<&Path>) -> Option<Self> {
        let plugin = env::home_dir().map(|home| home.join(".docker/cli-plugins/docker-compose"));
        let installed = PLUGIN_DIRS.iter().map(|dir| Path::new(dir).join("docker-compose"));
        cli::locate(
            "CONTAINERIA_COMPOSE",
            bundled,
            plugin.into_iter().chain(installed),
            "docker-compose",
        )
        .map(|bin| Self { bin, socket: socket.to_path_buf() })
    }

    /// Reads and checks the files, without touching the engine.
    ///
    /// # Errors
    /// Fails with Compose's message when the files don't parse or break the spec.
    pub async fn preview(
        &self,
        files: &ComposeFiles,
        name: Option<&str>,
    ) -> Result<ComposePreview> {
        let output = self.command(files, name, &["config", "--format", "json"])?.output().await?;
        if !output.status.success() {
            return Err(Error::Engine(cli::last_line(
                &String::from_utf8_lossy(&output.stderr),
                "Compose",
            )));
        }
        let raw: RawConfig = serde_json::from_slice(&output.stdout)
            .map_err(|error| Error::Engine(format!("Compose printed unreadable JSON: {error}")))?;
        Ok(raw.into())
    }

    /// Runs `verb` on the project, passing every line Compose prints to `on_line`.
    ///
    /// # Errors
    /// Fails with Compose's last line when it exits with an error.
    pub async fn run(
        &self,
        files: &ComposeFiles,
        name: &str,
        verb: ComposeVerb,
        on_line: impl FnMut(String),
    ) -> Result<()> {
        cli::stream(self.command(files, Some(name), verb.args())?, "Compose", on_line).await
    }

    fn command(&self, files: &ComposeFiles, name: Option<&str>, args: &[&str]) -> Result<Command> {
        let mut flags: Vec<OsString> =
            ["--ansi", "never", "--progress", "plain"].map(OsString::from).into();
        if let Some(name) = name {
            flags.extend(["--project-name".into(), name.into()]);
        }
        for file in &files.files {
            flags.extend(["--file".into(), file.into()]);
        }
        if let Some(directory) = &files.directory {
            flags.extend(["--project-directory".into(), directory.into()]);
        }
        flags.extend(args.iter().map(OsString::from));
        let mut command = cli::command(&self.bin, &self.socket, flags)?;
        command.env("COMPOSE_MENU", "false");
        Ok(command)
    }
}

impl Docker {
    /// The files a running project was started from, as Compose labels its containers.
    ///
    /// # Errors
    /// Fails when the engine can't be reached.
    pub async fn compose_files(&self, project: &str) -> Result<Option<ComposeFiles>> {
        let filters = HashMap::from([("label", vec![format!("{COMPOSE_PROJECT}={project}")])]);
        let options = ListContainersOptionsBuilder::new().all(true).filters(&filters).build();
        let containers = self.api.list_containers(Some(options)).await?;
        Ok(containers.into_iter().find_map(|container| files_from_labels(&container.labels?)))
    }
}

fn files_from_labels(labels: &HashMap<String, String>) -> Option<ComposeFiles> {
    let files: Vec<PathBuf> = labels
        .get(CONFIG_FILES)?
        .split(',')
        .filter(|file| !file.is_empty())
        .map(PathBuf::from)
        .collect();
    let directory = labels.get(WORKING_DIR).map(PathBuf::from);
    (!files.is_empty()).then_some(ComposeFiles { files, directory })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_the_files_a_project_came_from() {
        let labels = HashMap::from([
            (CONFIG_FILES.to_owned(), "/a/compose.yaml,/a/compose.override.yaml".to_owned()),
            (WORKING_DIR.to_owned(), "/a".to_owned()),
        ]);
        let files = files_from_labels(&labels).unwrap();
        assert_eq!(files.files.len(), 2);
        assert_eq!(files.directory, Some(PathBuf::from("/a")));
        assert_eq!(files_from_labels(&HashMap::new()), None);
    }

    #[test]
    fn checks_project_names_like_compose() {
        assert!(is_project_name("shop"));
        assert!(is_project_name("9lives_api-2"));
        assert!(!is_project_name(""));
        assert!(!is_project_name("Shop"));
        assert!(!is_project_name("-shop"));
        assert!(!is_project_name("my shop"));
    }

    #[test]
    fn makes_a_project_name_from_a_folder() {
        assert_eq!(project_name_from("My Shop.v2"), "myshopv2");
        assert_eq!(project_name_from("_api"), "api");
    }

    #[test]
    fn reads_services_out_of_compose_config() {
        let raw: RawConfig = serde_json::from_str(
            r#"{"name":"demo","services":{
                "web":{"image":"nginx:1.29","ports":[{"target":80,"published":"8080","protocol":"tcp"}]},
                "api":{"build":{"context":"/tmp/demo"},"ports":[{"target":3000}]}}}"#,
        )
        .unwrap();
        let preview = ComposePreview::from(raw);
        assert_eq!(preview.name, "demo");
        assert_eq!(preview.services[0].name, "api");
        assert!(preview.services[0].builds);
        assert_eq!(preview.services[0].ports, ["3000"]);
        assert_eq!(preview.services[1].image.as_deref(), Some("nginx:1.29"));
        assert_eq!(preview.services[1].ports, ["8080:80"]);
    }

    #[test]
    fn rebuild_forces_new_containers() {
        assert!(ComposeVerb::Rebuild.args().contains(&"--build"));
        assert!(ComposeVerb::Rebuild.args().contains(&"--force-recreate"));
        assert!(ComposeVerb::DownWithVolumes.args().contains(&"--volumes"));
        assert!(!ComposeVerb::Down.args().contains(&"--volumes"));
    }
}
