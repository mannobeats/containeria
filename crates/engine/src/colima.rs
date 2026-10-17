use std::env;
use std::ffi::OsStr;
use std::io;
use std::path::{Path, PathBuf};
use std::process::Stdio;

use serde::{Deserialize, Serialize};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

use crate::error::{Error, Result};
use crate::home::{Home, Profile};
use crate::log_line::LogLine;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum InstanceStatus {
    Running,
    Stopped,
    Broken,
    Unknown,
}

impl From<&str> for InstanceStatus {
    fn from(status: &str) -> Self {
        match status {
            "Running" => Self::Running,
            "Stopped" => Self::Stopped,
            "Broken" => Self::Broken,
            _ => Self::Unknown,
        }
    }
}

/// One line of `colima list --json`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Instance {
    pub status: InstanceStatus,
    pub arch: String,
    pub cpus: u32,
    #[specta(type = specta_typescript::Number)]
    pub memory_bytes: u64,
    #[specta(type = specta_typescript::Number)]
    pub disk_bytes: u64,
    pub address: Option<String>,
}

#[derive(Deserialize)]
struct RawInstance {
    #[serde(default)]
    status: String,
    #[serde(default)]
    arch: String,
    #[serde(default)]
    cpus: u32,
    #[serde(default)]
    memory: u64,
    #[serde(default)]
    disk: u64,
    #[serde(default)]
    address: String,
}

impl From<RawInstance> for Instance {
    fn from(raw: RawInstance) -> Self {
        Self {
            status: InstanceStatus::from(raw.status.as_str()),
            arch: raw.arch,
            cpus: raw.cpus,
            memory_bytes: raw.memory,
            disk_bytes: raw.disk,
            address: Some(raw.address).filter(|address| !address.is_empty()),
        }
    }
}

/// `colima status --json`, only available while the profile runs.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeInfo {
    pub driver: String,
    pub arch: String,
    pub runtime: String,
    #[serde(alias = "mount_type")]
    pub mount_type: String,
    #[serde(alias = "docker_socket", default)]
    pub docker_socket: String,
    #[serde(alias = "incus_socket", default)]
    pub incus_socket: String,
    pub kubernetes: bool,
}

/// The Colima CLI, run against Containeria's own Colima home.
#[derive(Debug, Clone)]
pub struct Colima {
    bin: PathBuf,
    home: Home,
}

impl Colima {
    /// Finds Colima: `$CONTAINERIA_COLIMA`, then the copy bundled with the app, then `$PATH`.
    ///
    /// # Errors
    /// Fails when no candidate exists.
    pub fn locate(home: Home, bundled: Option<&Path>) -> Result<Self> {
        let from_env = env::var_os("CONTAINERIA_COLIMA").map(PathBuf::from);
        let from_path = env::var_os("PATH")
            .into_iter()
            .flat_map(|path| env::split_paths(&path).collect::<Vec<_>>())
            .map(|dir| dir.join("colima"));
        from_env
            .into_iter()
            .chain(bundled.map(Path::to_path_buf))
            .chain(from_path)
            .find(|candidate| candidate.is_file())
            .map(|bin| Self { bin, home })
            .ok_or_else(|| Error::ColimaMissing {
                searched: "$CONTAINERIA_COLIMA, the app bundle and $PATH".to_owned(),
            })
    }

    #[must_use]
    pub const fn home(&self) -> &Home {
        &self.home
    }

    /// The profile's VM, or `None` if it was never created.
    ///
    /// # Errors
    /// Fails when Colima can't run or prints something unreadable.
    pub async fn instance(&self, profile: Profile) -> Result<Option<Instance>> {
        let stdout = self.output("list", profile, ["list", "--json"]).await?;
        stdout
            .lines()
            .filter(|line| !line.trim().is_empty())
            .map(|line| serde_json::from_str::<RawInstance>(line).map(Instance::from))
            .next()
            .transpose()
            .map_err(Error::from)
    }

    /// Details of a running profile.
    ///
    /// # Errors
    /// Fails when the profile isn't running.
    pub async fn runtime(&self, profile: Profile) -> Result<RuntimeInfo> {
        let stdout = self.output("status", profile, ["status", "--json"]).await?;
        Ok(serde_json::from_str(&stdout)?)
    }

    /// Starts the profile from its `colima.yaml`, reporting progress lines as they arrive.
    ///
    /// # Errors
    /// Fails with Colima's last error line when the start fails.
    pub async fn start(&self, profile: Profile, on_line: impl FnMut(LogLine)) -> Result<()> {
        self.stream("start", profile, ["start"], on_line).await
    }

    /// # Errors
    /// Fails with Colima's last error line when the stop fails.
    pub async fn stop(&self, profile: Profile, on_line: impl FnMut(LogLine)) -> Result<()> {
        self.stream("stop", profile, ["stop"], on_line).await
    }

    /// Deletes the VM and everything in it.
    ///
    /// # Errors
    /// Fails with Colima's last error line when the delete fails.
    pub async fn delete(&self, profile: Profile, on_line: impl FnMut(LogLine)) -> Result<()> {
        self.stream("delete", profile, ["delete", "--force"], on_line).await
    }

    fn command<I, S>(&self, profile: Profile, args: I) -> Result<Command>
    where
        I: IntoIterator<Item = S>,
        S: AsRef<OsStr>,
    {
        // Colima ignores COLIMA_HOME unless the folder already exists.
        std::fs::create_dir_all(self.home.colima())?;
        let mut command = Command::new(&self.bin);
        command
            .args(args)
            .args(["--profile", profile.name()])
            .env("COLIMA_HOME", self.home.colima())
            .stdin(Stdio::null())
            .kill_on_drop(true);
        Ok(command)
    }

    async fn output<const N: usize>(
        &self,
        action: &'static str,
        profile: Profile,
        args: [&str; N],
    ) -> Result<String> {
        let output = self.command(profile, args)?.output().await?;
        if output.status.success() {
            return Ok(String::from_utf8_lossy(&output.stdout).into_owned());
        }
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(Error::Command { action, message: last_error(stderr.lines()) })
    }

    async fn stream<const N: usize>(
        &self,
        action: &'static str,
        profile: Profile,
        args: [&str; N],
        mut on_line: impl FnMut(LogLine),
    ) -> Result<()> {
        let mut child =
            self.command(profile, args)?.stdout(Stdio::null()).stderr(Stdio::piped()).spawn()?;
        let stderr = child.stderr.take().ok_or_else(|| io::Error::other("stderr was not piped"))?;
        let mut lines = BufReader::new(stderr).lines();
        let mut seen = Vec::new();
        while let Some(line) = lines.next_line().await? {
            if let Some(parsed) = LogLine::parse(&line) {
                tracing::debug!(target: "colima", action, "{}", parsed.message);
                seen.push(line);
                on_line(parsed);
            }
        }
        if child.wait().await?.success() {
            return Ok(());
        }
        Err(Error::Command { action, message: last_error(seen.iter().map(String::as_str)) })
    }
}

fn last_error<'a>(lines: impl DoubleEndedIterator<Item = &'a str>) -> String {
    lines.rev().find_map(LogLine::parse).map_or_else(|| "no output".to_owned(), |line| line.message)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_a_colima_list_line() {
        let raw: RawInstance = serde_json::from_str(
            r#"{"name":"containeria","status":"Running","arch":"aarch64","cpus":4,
                "memory":8589934592,"disk":107374182400,"address":"","runtime":"docker"}"#,
        )
        .unwrap();
        let instance = Instance::from(raw);
        assert_eq!(instance.status, InstanceStatus::Running);
        assert_eq!(instance.memory_bytes, 8 * 1024 * 1024 * 1024);
        assert_eq!(instance.address, None);
    }

    #[test]
    fn reads_colima_status_json() {
        let info: RuntimeInfo = serde_json::from_str(
            r#"{"display_name":"colima [profile=containeria]","driver":"macOS Virtualization.Framework",
                "arch":"aarch64","runtime":"docker","mount_type":"virtiofs",
                "docker_socket":"unix:///Users/ada/.containeria/colima/containeria/docker.sock",
                "kubernetes":false,"cpu":4,"memory":8589934592,"disk":107374182400}"#,
        )
        .unwrap();
        assert_eq!(info.mount_type, "virtiofs");
        assert!(info.docker_socket.ends_with("docker.sock"));
    }

    #[test]
    fn reports_the_last_error_line() {
        let lines = [
            r#"time="x" level=info msg="starting colima""#,
            r#"time="x" level=fatal msg="error starting vm: disk locked""#,
        ];
        assert_eq!(last_error(lines.into_iter()), "error starting vm: disk locked");
    }
}
