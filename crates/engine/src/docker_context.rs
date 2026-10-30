use std::env;
use std::ffi::OsString;
use std::fs::{self, OpenOptions, Permissions};
use std::io::{ErrorKind, Write};
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use tokio::net::{TcpStream, UnixStream};

use crate::error::{Error, Result};

const DEFAULT_CONTEXT: &str = "default";
const DEFAULT_HOST: &str = "unix:///var/run/docker.sock";
const CURRENT_CONTEXT: &str = "currentContext";
/// A dead socket refuses at once; this only bounds an endpoint that hangs.
const ANSWER_WITHIN: Duration = Duration::from_millis(500);

/// The Docker CLI's current context while it isn't Containeria's.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ForeignContext {
    pub name: String,
    /// Absent when no context has that name, so every `docker` command fails.
    pub endpoint: Option<String>,
    /// Whether something listens at the endpoint; absent when that can't be checked, as for `ssh://`.
    pub answers: Option<bool>,
}

/// The Docker CLI's configuration folder: `$DOCKER_CONFIG`, or `~/.docker`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DockerConfig {
    dir: PathBuf,
    /// `$DOCKER_HOST`, which is where the `default` context points when set.
    docker_host: Option<String>,
}

impl DockerConfig {
    /// # Errors
    /// Fails when `DOCKER_CONFIG` isn't set and there is no home folder.
    pub fn from_env() -> Result<Self> {
        Self::from_vars(env::var_os("DOCKER_CONFIG"), env::var("DOCKER_HOST").ok(), env::home_dir())
    }

    fn from_vars(
        docker_config: Option<OsString>,
        docker_host: Option<String>,
        home: Option<PathBuf>,
    ) -> Result<Self> {
        let dir = match docker_config {
            Some(dir) => PathBuf::from(dir),
            None => home.ok_or(Error::NoHomeFolder)?.join(".docker"),
        };
        Ok(Self { dir, docker_host: docker_host.filter(|host| !host.is_empty()) })
    }

    fn file(&self) -> PathBuf {
        self.dir.join("config.json")
    }

    /// `currentContext` from `config.json`. No file, or no value, means `default`.
    ///
    /// # Errors
    /// Fails when the file can't be read or isn't JSON.
    pub fn current_context(&self) -> Result<String> {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct ConfigFile {
            #[serde(default)]
            current_context: String,
        }
        let path = self.file();
        let name = match fs::read(&path) {
            Ok(bytes) => parse::<ConfigFile>(&path, &bytes)?.current_context,
            Err(error) if error.kind() == ErrorKind::NotFound => String::new(),
            Err(error) => return Err(error.into()),
        };
        Ok(if name.is_empty() { DEFAULT_CONTEXT.to_owned() } else { name })
    }

    /// The Docker host a context sends commands to, or `None` when no context has that name.
    /// Docker files each context under the SHA-256 of its name; matching on the `Name` inside
    /// finds the same one without hashing.
    ///
    /// # Errors
    /// Fails when the contexts folder exists but can't be read.
    pub fn endpoint(&self, name: &str) -> Result<Option<String>> {
        #[derive(Deserialize)]
        #[serde(rename_all = "PascalCase")]
        struct Meta {
            name: String,
            endpoints: Endpoints,
        }
        #[derive(Deserialize)]
        struct Endpoints {
            docker: Endpoint,
        }
        #[derive(Deserialize)]
        #[serde(rename_all = "PascalCase")]
        struct Endpoint {
            host: String,
        }
        if name == DEFAULT_CONTEXT {
            return Ok(Some(self.docker_host.clone().unwrap_or_else(|| DEFAULT_HOST.to_owned())));
        }
        let entries = match fs::read_dir(self.dir.join("contexts").join("meta")) {
            Ok(entries) => entries,
            Err(error) if error.kind() == ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(error.into()),
        };
        Ok(entries
            .flatten()
            .filter_map(|entry| fs::read(entry.path().join("meta.json")).ok())
            .filter_map(|bytes| serde_json::from_slice::<Meta>(&bytes).ok())
            .find(|meta| meta.name == name)
            .map(|meta| meta.endpoints.docker.host))
    }

    /// The current context when it isn't `ours`. Nothing while `ours` doesn't exist yet: there is
    /// nothing to switch back to, and the engine's first start creates and selects it.
    ///
    /// # Errors
    /// Fails when `config.json` or the contexts can't be read.
    pub async fn foreign_context(&self, ours: &str) -> Result<Option<ForeignContext>> {
        let name = self.current_context()?;
        if name == ours || self.endpoint(ours)?.is_none() {
            return Ok(None);
        }
        let endpoint = self.endpoint(&name)?;
        let answers = match &endpoint {
            Some(endpoint) => answers(endpoint).await,
            None => Some(false),
        };
        Ok(Some(ForeignContext { name, endpoint, answers }))
    }

    /// Makes `name` the current context, as `docker context use` does. Only `currentContext`
    /// changes: logins, credential helpers and every other key stay, and so do the file's
    /// permissions. The new file is written beside the old one and renamed over it, so a crash
    /// never leaves half a file. A symlinked `config.json` keeps its link.
    ///
    /// # Errors
    /// Fails when no context has that name, or `config.json` can't be read, parsed or written.
    pub fn use_context(&self, name: &str) -> Result<()> {
        if self.endpoint(name)?.is_none() {
            return Err(Error::NoDockerContext(name.to_owned()));
        }
        let link = self.file();
        let path = fs::canonicalize(&link).unwrap_or(link);
        let (mut config, mode) = match fs::read(&path) {
            Ok(bytes) => {
                let mode = fs::metadata(&path)?.permissions().mode() & 0o7777;
                (parse::<Map<String, Value>>(&path, &bytes)?, mode)
            }
            Err(error) if error.kind() == ErrorKind::NotFound => (Map::new(), 0o600),
            Err(error) => return Err(error.into()),
        };
        if name == DEFAULT_CONTEXT {
            config.remove(CURRENT_CONTEXT);
        } else {
            config.insert(CURRENT_CONTEXT.to_owned(), Value::String(name.to_owned()));
        }
        // Docker writes the file tab-indented.
        let mut text = Vec::new();
        let formatter = serde_json::ser::PrettyFormatter::with_indent(b"\t");
        config.serialize(&mut serde_json::Serializer::with_formatter(&mut text, formatter))?;
        replace(&path, &text, mode)
    }
}

fn parse<T: serde::de::DeserializeOwned>(path: &Path, bytes: &[u8]) -> Result<T> {
    serde_json::from_slice(bytes)
        .map_err(|source| Error::DockerConfig { path: path.display().to_string(), source })
}

fn replace(path: &Path, contents: &[u8], mode: u32) -> Result<()> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    let temp = path.with_extension("json.containeria");
    let _ = fs::remove_file(&temp);
    let written = (|| {
        let mut file = OpenOptions::new().write(true).create_new(true).mode(mode).open(&temp)?;
        // `mode` above is filtered through the umask; this sets it exactly.
        file.set_permissions(Permissions::from_mode(mode))?;
        file.write_all(contents)?;
        file.sync_all()?;
        fs::rename(&temp, path)
    })();
    if written.is_err() {
        let _ = fs::remove_file(&temp);
    }
    Ok(written?)
}

/// Whether something accepts a connection at a `unix://` or `tcp://` Docker host.
async fn answers(endpoint: &str) -> Option<bool> {
    let attempt = if let Some(path) = endpoint.strip_prefix("unix://") {
        tokio::time::timeout(ANSWER_WITHIN, UnixStream::connect(path.to_owned()))
            .await
            .map(|connected| connected.is_ok())
    } else {
        let address = endpoint.strip_prefix("tcp://")?;
        tokio::time::timeout(ANSWER_WITHIN, TcpStream::connect(address.to_owned()))
            .await
            .map(|connected| connected.is_ok())
    };
    Some(attempt.unwrap_or(false))
}

#[cfg(test)]
mod tests {
    use std::os::unix::net::UnixListener;

    use super::*;
    use crate::home::Profile;

    fn docker_dir() -> (tempfile::TempDir, DockerConfig) {
        let dir = tempfile::tempdir().unwrap();
        let config = DockerConfig { dir: dir.path().to_owned(), docker_host: None };
        (dir, config)
    }

    /// Lays a context out the way `docker context create` does.
    fn add_context(config: &DockerConfig, name: &str, host: &str) {
        let dir = config.dir.join("contexts/meta").join(format!("{name}-hash"));
        fs::create_dir_all(&dir).unwrap();
        let meta = serde_json::json!({
            "Name": name,
            "Metadata": {},
            "Endpoints": { "docker": { "Host": host, "SkipTLSVerify": false } },
        });
        fs::write(dir.join("meta.json"), meta.to_string()).unwrap();
    }

    fn write_config(config: &DockerConfig, json: &str) {
        fs::create_dir_all(&config.dir).unwrap();
        fs::write(config.file(), json).unwrap();
    }

    fn ours() -> String {
        Profile::Containers.docker_context()
    }

    #[test]
    fn names_the_context_after_the_profile_as_colima_does() {
        assert_eq!(Profile::Containers.docker_context(), "colima-containeria");
        assert_eq!(Profile::Machines.docker_context(), "colima-containeria-machines");
    }

    #[test]
    fn reads_the_current_context() {
        let (_dir, config) = docker_dir();
        write_config(&config, r#"{"auths":{},"currentContext":"colima"}"#);
        assert_eq!(config.current_context().unwrap(), "colima");
    }

    #[test]
    fn a_config_without_current_context_means_default() {
        let (_dir, config) = docker_dir();
        assert_eq!(config.current_context().unwrap(), "default");
        write_config(&config, r#"{"auths":{}}"#);
        assert_eq!(config.current_context().unwrap(), "default");
    }

    #[test]
    fn reads_the_folder_docker_config_names() {
        let config =
            DockerConfig::from_vars(Some("/tmp/elsewhere".into()), None, Some("/Users/ada".into()))
                .unwrap();
        assert_eq!(config.file(), PathBuf::from("/tmp/elsewhere/config.json"));
        let config = DockerConfig::from_vars(None, None, Some("/Users/ada".into())).unwrap();
        assert_eq!(config.file(), PathBuf::from("/Users/ada/.docker/config.json"));
    }

    #[test]
    fn default_points_at_docker_host_when_set() {
        let (_dir, mut config) = docker_dir();
        assert_eq!(config.endpoint("default").unwrap().as_deref(), Some(DEFAULT_HOST));
        config.docker_host = Some("tcp://10.0.0.2:2375".into());
        assert_eq!(config.endpoint("default").unwrap().as_deref(), Some("tcp://10.0.0.2:2375"));
    }

    #[tokio::test]
    async fn says_nothing_while_on_containerias_own_context() {
        let (_dir, config) = docker_dir();
        add_context(
            &config,
            &ours(),
            "unix:///Users/ada/.containeria/colima/containeria/docker.sock",
        );
        write_config(&config, &format!(r#"{{"currentContext":"{}"}}"#, ours()));
        assert_eq!(config.foreign_context(&ours()).await.unwrap(), None);
    }

    #[tokio::test]
    async fn says_nothing_before_containerias_context_exists() {
        let (_dir, config) = docker_dir();
        add_context(&config, "colima", "unix:///Users/ada/.colima/default/docker.sock");
        write_config(&config, r#"{"currentContext":"colima"}"#);
        assert_eq!(config.foreign_context(&ours()).await.unwrap(), None);
    }

    #[tokio::test]
    async fn names_another_engines_context_and_whether_it_answers() {
        let (dir, config) = docker_dir();
        add_context(&config, &ours(), "unix:///nowhere/docker.sock");
        let socket = dir.path().join("other.sock");
        let _listener = UnixListener::bind(&socket).unwrap();
        let host = format!("unix://{}", socket.display());
        add_context(&config, "colima", &host);
        write_config(&config, r#"{"currentContext":"colima"}"#);
        assert_eq!(
            config.foreign_context(&ours()).await.unwrap(),
            Some(ForeignContext {
                name: "colima".into(),
                endpoint: Some(host),
                answers: Some(true)
            })
        );
    }

    #[tokio::test]
    async fn notices_the_default_context_and_its_dead_socket() {
        let (dir, mut config) = docker_dir();
        add_context(&config, &ours(), "unix:///nowhere/docker.sock");
        let host = format!("unix://{}", dir.path().join("gone.sock").display());
        config.docker_host = Some(host.clone());
        let found = config.foreign_context(&ours()).await.unwrap().unwrap();
        assert_eq!(
            found,
            ForeignContext { name: "default".into(), endpoint: Some(host), answers: Some(false) }
        );
    }

    #[tokio::test]
    async fn an_unknown_context_has_no_endpoint() {
        let (_dir, config) = docker_dir();
        add_context(&config, &ours(), "unix:///nowhere/docker.sock");
        write_config(&config, r#"{"currentContext":"orbstack"}"#);
        assert_eq!(
            config.foreign_context(&ours()).await.unwrap(),
            Some(ForeignContext { name: "orbstack".into(), endpoint: None, answers: Some(false) })
        );
    }

    #[tokio::test]
    async fn cant_check_an_ssh_endpoint() {
        assert_eq!(answers("ssh://ada@build-box").await, None);
    }

    #[test]
    fn switching_back_changes_only_current_context() {
        let (_dir, config) = docker_dir();
        add_context(&config, &ours(), "unix:///nowhere/docker.sock");
        let before = serde_json::json!({
            "auths": { "ghcr.io": { "auth": "c2VjcmV0" } },
            "credsStore": "osxkeychain",
            "credHelpers": { "123.dkr.ecr.eu-west-1.amazonaws.com": "ecr-login" },
            "cliPluginsExtraDirs": ["/Applications/Containeria.app/Contents/Resources/tools/cli-plugins"],
            "currentContext": "colima",
        });
        write_config(&config, &before.to_string());
        fs::set_permissions(config.file(), Permissions::from_mode(0o640)).unwrap();

        config.use_context(&ours()).unwrap();

        let after: Value = serde_json::from_slice(&fs::read(config.file()).unwrap()).unwrap();
        let mut expected = before;
        expected["currentContext"] = Value::String(ours());
        assert_eq!(after, expected);
        assert_eq!(fs::metadata(config.file()).unwrap().permissions().mode() & 0o777, 0o640);
        assert_eq!(config.current_context().unwrap(), ours());
        let leftovers: Vec<_> = fs::read_dir(&config.dir).unwrap().flatten().collect();
        assert_eq!(leftovers.len(), 2, "only config.json and contexts remain");
    }

    #[test]
    fn switching_back_writes_through_a_symlinked_config() {
        let (dir, config) = docker_dir();
        add_context(&config, &ours(), "unix:///nowhere/docker.sock");
        let real = dir.path().join("dotfiles-config.json");
        fs::write(&real, r#"{"currentContext":"colima"}"#).unwrap();
        std::os::unix::fs::symlink(&real, config.file()).unwrap();

        config.use_context(&ours()).unwrap();

        assert!(fs::symlink_metadata(config.file()).unwrap().file_type().is_symlink());
        assert_eq!(config.current_context().unwrap(), ours());
    }

    #[test]
    fn switching_back_creates_a_private_config_when_there_is_none() {
        let (_dir, config) = docker_dir();
        add_context(&config, &ours(), "unix:///nowhere/docker.sock");
        config.use_context(&ours()).unwrap();
        assert_eq!(config.current_context().unwrap(), ours());
        assert_eq!(fs::metadata(config.file()).unwrap().permissions().mode() & 0o777, 0o600);
    }

    #[test]
    fn refuses_a_context_that_doesnt_exist() {
        let (_dir, config) = docker_dir();
        write_config(&config, r#"{"currentContext":"colima"}"#);
        assert!(matches!(config.use_context(&ours()), Err(Error::NoDockerContext(_))));
        assert_eq!(config.current_context().unwrap(), "colima");
    }

    #[test]
    fn leaves_a_config_it_cant_read_alone() {
        let (_dir, config) = docker_dir();
        add_context(&config, &ours(), "unix:///nowhere/docker.sock");
        write_config(&config, "{ not json");
        assert!(matches!(config.use_context(&ours()), Err(Error::DockerConfig { .. })));
        assert_eq!(fs::read_to_string(config.file()).unwrap(), "{ not json");
    }
}
