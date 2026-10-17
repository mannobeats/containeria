//! Docker's own command-line tools, run against Containeria's engine for what the Engine API
//! leaves to them: Compose, `BuildKit` builds, and pushes that use the user's registry logins.

use std::env;
use std::ffi::OsStr;
use std::io;
use std::path::{Path, PathBuf};
use std::process::Stdio;

use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

use crate::{Error, Result};

/// Folders Homebrew and Docker's installers put the CLI and its plugins in. Apps opened from
/// Finder get only the system `PATH`.
const TOOL_DIRS: [&str; 2] = ["/opt/homebrew/bin", "/usr/local/bin"];

/// `PATH` for a tool: its own folder first, so a bundled tool finds bundled plugins.
fn search_path(bin: &Path) -> io::Result<std::ffi::OsString> {
    let dirs =
        bin.parent().map(Path::to_path_buf).into_iter().chain(TOOL_DIRS.map(PathBuf::from)).chain(
            env::var_os("PATH")
                .into_iter()
                .flat_map(|path| env::split_paths(&path).collect::<Vec<_>>()),
        );
    env::join_paths(dirs).map_err(io::Error::other)
}

/// The first file that exists among `$override_var`, the bundled copy, `extra` and `name` in the
/// tool folders and on `PATH`.
pub(crate) fn locate(
    override_var: &str,
    bundled: Option<&Path>,
    extra: impl IntoIterator<Item = PathBuf>,
    name: &str,
) -> Option<PathBuf> {
    let on_path = TOOL_DIRS
        .map(PathBuf::from)
        .into_iter()
        .chain(
            env::var_os("PATH")
                .into_iter()
                .flat_map(|path| env::split_paths(&path).collect::<Vec<_>>()),
        )
        .map(|dir| dir.join(name));
    env::var_os(override_var)
        .map(PathBuf::from)
        .into_iter()
        .chain(bundled.map(Path::to_path_buf))
        .chain(extra)
        .chain(on_path)
        .find(|candidate| candidate.is_file())
}

/// A tool command aimed at the engine's socket.
pub(crate) fn command<I, S>(bin: &Path, socket: &Path, args: I) -> Result<Command>
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    let mut command = Command::new(bin);
    command
        .args(args)
        .env("DOCKER_HOST", format!("unix://{}", socket.display()))
        .env("PATH", search_path(bin)?)
        .stdin(Stdio::null())
        .kill_on_drop(true);
    Ok(command)
}

/// Runs `command`, passing every line it prints on stdout or stderr to `on_line`.
///
/// # Errors
/// Fails with the last line printed when the command exits with an error.
pub(crate) async fn stream(
    mut command: Command,
    tool: &str,
    mut on_line: impl FnMut(String),
) -> Result<()> {
    let mut child = command.stdout(Stdio::piped()).stderr(Stdio::piped()).spawn()?;
    let stdout = child.stdout.take().ok_or_else(|| io::Error::other("stdout was not piped"))?;
    let stderr = child.stderr.take().ok_or_else(|| io::Error::other("stderr was not piped"))?;
    let mut stdout = BufReader::new(stdout).lines();
    let mut stderr = BufReader::new(stderr).lines();
    let (mut out_open, mut err_open) = (true, true);
    let mut last = String::new();
    while out_open || err_open {
        let line = tokio::select! {
            line = stdout.next_line(), if out_open => line?.or_else(|| { out_open = false; None }),
            line = stderr.next_line(), if err_open => line?.or_else(|| { err_open = false; None }),
        };
        if let Some(line) = line.filter(|line| !line.trim().is_empty()) {
            last.clone_from(&line);
            on_line(line);
        }
    }
    if child.wait().await?.success() {
        return Ok(());
    }
    Err(Error::Engine(if last.is_empty() { format!("{tool} failed") } else { last }))
}

/// The Docker CLI, for builds (`BuildKit` through buildx) and pushes (with the user's logins).
#[derive(Debug, Clone)]
pub struct DockerCli {
    bin: PathBuf,
    socket: PathBuf,
    /// The bundled CLI's own configuration: the user's, plus the bundled plugins (buildx).
    config: Option<(PathBuf, PathBuf)>,
}

/// What to build: the folder sent to the builder, the Dockerfile in it, and the name to give.
#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct BuildSpec {
    pub context: String,
    /// Relative to `context`, or absolute; `Dockerfile` in the context when empty.
    pub dockerfile: Option<String>,
    pub tag: String,
    /// Build arguments as `KEY=value`.
    #[serde(default)]
    pub build_args: Vec<String>,
    /// Ignore the build cache.
    #[serde(default)]
    pub no_cache: bool,
    /// Pull newer base images.
    #[serde(default)]
    pub pull: bool,
}

impl BuildSpec {
    fn args(&self) -> Vec<String> {
        let mut args = vec!["build".to_owned(), "--progress".to_owned(), "plain".to_owned()];
        args.extend(["--tag".to_owned(), self.tag.clone()]);
        if let Some(dockerfile) = self.dockerfile.as_ref().filter(|file| !file.is_empty()) {
            args.extend(["--file".to_owned(), dockerfile.clone()]);
        }
        for build_arg in &self.build_args {
            args.extend(["--build-arg".to_owned(), build_arg.clone()]);
        }
        if self.no_cache {
            args.push("--no-cache".to_owned());
        }
        if self.pull {
            args.push("--pull".to_owned());
        }
        args.push(self.context.clone());
        args
    }
}

impl DockerCli {
    /// Finds `docker`: `$CONTAINERIA_DOCKER`, the copy bundled with the app, then Homebrew and
    /// `PATH`. When the bundled copy is used, it reads `config_dir`, which mirrors the user's
    /// `~/.docker/config.json` so `docker login` still applies, and adds `plugins` so it finds
    /// the bundled buildx.
    #[must_use]
    pub fn locate(
        socket: &Path,
        bundled: Option<&Path>,
        plugins: Option<&Path>,
        config_dir: &Path,
    ) -> Option<Self> {
        let bin = locate("CONTAINERIA_DOCKER", bundled, [], "docker")?;
        let config = plugins
            .filter(|_| bundled.is_some_and(|bundled| bundled == bin))
            .map(|plugins| (config_dir.to_path_buf(), plugins.to_path_buf()));
        Some(Self { bin, socket: socket.to_path_buf(), config })
    }

    fn command<I, S>(&self, args: I) -> Result<Command>
    where
        I: IntoIterator<Item = S>,
        S: AsRef<OsStr>,
    {
        let mut command = command(&self.bin, &self.socket, args)?;
        if let Some((dir, plugins)) = &self.config {
            let user = env::home_dir().map(|home| home.join(".docker/config.json"));
            write_config(dir, user.as_deref(), plugins)?;
            command.env("DOCKER_CONFIG", dir);
        }
        Ok(command)
    }

    /// Builds an image, passing `BuildKit`'s plain progress to `on_line`.
    ///
    /// # Errors
    /// Fails with the builder's last line when the build fails.
    pub async fn build(&self, spec: &BuildSpec, on_line: impl FnMut(String)) -> Result<()> {
        let mut command = self.command(spec.args())?;
        command.current_dir(&spec.context).env("BUILDKIT_PROGRESS", "plain");
        stream(command, "The build", on_line).await
    }

    /// Pushes `reference` with the logins `docker login` saved.
    ///
    /// # Errors
    /// Fails with the registry's answer when the push is refused.
    pub async fn push(&self, reference: &str, on_line: impl FnMut(String)) -> Result<()> {
        let command = self.command(["push", reference])?;
        stream(command, "The push", on_line).await
    }
}

/// Writes `dir/config.json`: the user's Docker configuration (logins, credential helpers) with
/// `plugins` added to where the CLI looks for plugins.
fn write_config(dir: &Path, user: Option<&Path>, plugins: &Path) -> io::Result<()> {
    let mut config: serde_json::Map<String, serde_json::Value> = user
        .and_then(|path| std::fs::read(path).ok())
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default();
    config.insert("cliPluginsExtraDirs".to_owned(), serde_json::json!([plugins.to_string_lossy()]));
    std::fs::create_dir_all(dir)?;
    std::fs::write(dir.join("config.json"), serde_json::to_vec_pretty(&config)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_with_the_options_asked_for() {
        let spec = BuildSpec {
            context: "/Users/ada/shop".to_owned(),
            dockerfile: Some("docker/api.Dockerfile".to_owned()),
            tag: "shop-api:dev".to_owned(),
            build_args: vec!["NODE_ENV=production".to_owned()],
            no_cache: true,
            pull: false,
        };
        assert_eq!(
            spec.args(),
            [
                "build",
                "--progress",
                "plain",
                "--tag",
                "shop-api:dev",
                "--file",
                "docker/api.Dockerfile",
                "--build-arg",
                "NODE_ENV=production",
                "--no-cache",
                "/Users/ada/shop"
            ]
        );
    }

    #[test]
    fn keeps_the_users_logins_and_adds_the_bundled_plugins() {
        let dir = tempfile::tempdir().unwrap();
        let user = dir.path().join("user.json");
        std::fs::write(&user, r#"{"credsStore":"osxkeychain","auths":{"ghcr.io":{}}}"#).unwrap();
        let own = dir.path().join("own");
        write_config(&own, Some(&user), Path::new("/App/tools/cli-plugins")).unwrap();
        let written: serde_json::Value =
            serde_json::from_slice(&std::fs::read(own.join("config.json")).unwrap()).unwrap();
        assert_eq!(written["credsStore"], "osxkeychain");
        assert!(written["auths"]["ghcr.io"].is_object());
        assert_eq!(written["cliPluginsExtraDirs"][0], "/App/tools/cli-plugins");
    }

    #[test]
    fn looks_in_the_tool_folder_first() {
        let path =
            search_path(Path::new("/Applications/Containeria.app/Contents/Resources/bin/docker"))
                .unwrap();
        let first = env::split_paths(&path).next().unwrap();
        assert_eq!(first, Path::new("/Applications/Containeria.app/Contents/Resources/bin"));
    }
}
