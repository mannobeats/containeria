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
    name: String,
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KubernetesAction {
    Start,
    Stop,
    /// Deletes every Kubernetes object and starts a fresh cluster; images stay cached.
    Reset,
}

/// The Colima CLI, run against Containeria's own Colima home.
/// Where Homebrew installs on Apple silicon and on Intel. Apps opened from Finder get only the
/// system `PATH`, which has neither.
const HOMEBREW_BINS: [&str; 2] = ["/opt/homebrew/bin", "/usr/local/bin"];

/// The folders Colima and the tools it runs (`limactl`, `incus`) are looked up in: next to Colima
/// first, so a bundled copy finds its bundled tools, then Homebrew, then the inherited `PATH`.
fn search_path(colima_dir: Option<&Path>) -> Vec<PathBuf> {
    colima_dir
        .map(Path::to_path_buf)
        .into_iter()
        .chain(HOMEBREW_BINS.map(PathBuf::from))
        .chain(env::var_os("PATH").iter().flat_map(env::split_paths))
        .collect()
}

#[derive(Debug, Clone)]
pub struct Colima {
    bin: PathBuf,
    home: Home,
}

impl Colima {
    /// Finds Colima: `$CONTAINERIA_COLIMA`, then the copy bundled with the app, then Homebrew and
    /// `$PATH`.
    ///
    /// # Errors
    /// Fails when no candidate exists.
    pub fn locate(home: Home, bundled: Option<&Path>) -> Result<Self> {
        let from_env = env::var_os("CONTAINERIA_COLIMA").map(PathBuf::from);
        let from_path = search_path(None).into_iter().map(|dir| dir.join("colima"));
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

    /// Colima at a known path, such as a stand-in script in a test.
    #[must_use]
    pub const fn at(bin: PathBuf, home: Home) -> Self {
        Self { bin, home }
    }

    #[must_use]
    pub const fn home(&self) -> &Home {
        &self.home
    }

    /// A tool Colima runs, such as `incus`, from the same folders Colima looks in.
    #[must_use]
    pub fn tool(&self, name: &str) -> Option<PathBuf> {
        search_path(self.bin.parent())
            .into_iter()
            .map(|dir| dir.join(name))
            .find(|path| path.is_file())
    }

    /// The profile's VM, or `None` if it was never created.
    ///
    /// # Errors
    /// Fails when Colima can't run or prints something unreadable.
    pub async fn instance(&self, profile: Profile) -> Result<Option<Instance>> {
        // Listing every instance: with `--profile`, Colima fails until that profile exists.
        let stdout = self.output("list", None, ["list", "--json"]).await?;
        find_instance(&stdout, profile)
    }

    /// Details of a running profile.
    ///
    /// # Errors
    /// Fails when the profile isn't running.
    pub async fn runtime(&self, profile: Profile) -> Result<RuntimeInfo> {
        let stdout = self.output("status", Some(profile), ["status", "--json"]).await?;
        Ok(serde_json::from_str(&stdout)?)
    }

    /// Has each running profile's guest discard its free blocks with `fstrim -a`, so space freed
    /// inside the VM leaves its sparse disk files, and returns how many bytes those files shrank
    /// by on the Mac. The guest's weekly `fstrim.timer` does the same, but long after a clean-up.
    ///
    /// Runs through `colima ssh`, not a privileged `nsenter` container like the engine shell: the
    /// machines profile has no Docker to start one in, and `ssh` reaches both guests the same way
    /// with the tools Colima already bundles.
    ///
    /// # Errors
    /// Fails when Colima can't list the profiles or a guest's trim fails.
    pub async fn return_free_space(&self) -> Result<u64> {
        let list = self.output("list", None, ["list", "--json"]).await?;
        let mut running = Vec::new();
        for profile in [Profile::Containers, Profile::Machines] {
            let instance = find_instance(&list, profile)?;
            if instance.is_some_and(|instance| instance.status == InstanceStatus::Running) {
                running.push(profile);
            }
        }
        let size = || -> u64 {
            running.iter().map(|profile| crate::storage::disk_size(&self.home, *profile)).sum()
        };
        let before = size();
        for profile in &running {
            let trim = ["ssh", "--profile", profile.name(), "--", "sudo", "fstrim", "-a"];
            self.output("ssh -- sudo fstrim -a", None, trim).await?;
        }
        Ok(before.saturating_sub(size()))
    }

    /// The Colima release, such as `0.10.3`.
    ///
    /// # Errors
    /// Fails when Colima can't run.
    pub async fn version(&self) -> Result<String> {
        let stdout = self.output("version", None, ["version"]).await?;
        Ok(parse_version(&stdout))
    }

    /// Starts the profile from its `colima.yaml`, reporting progress lines as they arrive.
    ///
    /// # Errors
    /// Fails with Colima's last error line when the start fails.
    pub async fn start(&self, profile: Profile, on_line: impl FnMut(LogLine)) -> Result<()> {
        pin_virtiofs(&self.home.lima())?;
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

    /// Starts, stops or resets k3s inside the running containers VM, without restarting the VM.
    ///
    /// # Errors
    /// Fails with Colima's last error line.
    pub async fn kubernetes(
        &self,
        action: KubernetesAction,
        on_line: impl FnMut(LogLine),
    ) -> Result<()> {
        let (name, verb) = match action {
            KubernetesAction::Start => ("kubernetes start", "start"),
            KubernetesAction::Stop => ("kubernetes stop", "stop"),
            KubernetesAction::Reset => ("kubernetes reset", "reset"),
        };
        self.stream(name, Profile::Containers, ["kubernetes", verb], on_line).await
    }

    fn command<I, S>(&self, profile: Option<Profile>, args: I) -> Result<Command>
    where
        I: IntoIterator<Item = S>,
        S: AsRef<OsStr>,
    {
        // Colima ignores COLIMA_HOME unless the folder already exists.
        std::fs::create_dir_all(self.home.colima())?;
        let mut command = Command::new(&self.bin);
        command.args(args);
        if let Some(profile) = profile {
            command.args(["--profile", profile.name()]);
        }
        command
            .env("COLIMA_HOME", self.home.colima())
            .env("PATH", env::join_paths(search_path(self.bin.parent())).map_err(io::Error::other)?)
            .stdin(Stdio::null())
            .kill_on_drop(true);
        Ok(command)
    }

    async fn output<const N: usize>(
        &self,
        action: &'static str,
        profile: Option<Profile>,
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
        let mut child = self
            .command(Some(profile), args)?
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()?;
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

/// `colima version 0.10.3` on the first line, then build details.
fn parse_version(stdout: &str) -> String {
    let first = stdout.lines().next().unwrap_or_default();
    first.rsplit(' ').next().unwrap_or(first).trim().to_owned()
}

/// Picks one profile's line out of `colima list --json`, which prints one JSON object per line.
fn find_instance(list: &str, profile: Profile) -> Result<Option<Instance>> {
    for line in list.lines().filter(|line| !line.trim().is_empty()) {
        let raw: RawInstance = serde_json::from_str(line)?;
        if raw.name == profile.name() {
            return Ok(Some(raw.into()));
        }
    }
    Ok(None)
}

fn last_error<'a>(lines: impl DoubleEndedIterator<Item = &'a str>) -> String {
    lines.rev().find_map(LogLine::parse).map_or_else(|| "no output".to_owned(), |line| line.message)
}

/// Colima v0.10.3 asks Lima for 9p mounts on every VM type but vz, and Lima's krunkit driver
/// refuses 9p (abiosoft/colima#1607). Lima's override file wins over what Colima asks for, and
/// virtiofs is what every Containeria VM uses anyway.
fn pin_virtiofs(lima: &Path) -> Result<()> {
    const OVERRIDE: &str = "mountType: virtiofs\n";
    let path = lima.join("_config").join("override.yaml");
    if std::fs::read_to_string(&path).is_ok_and(|current| current == OVERRIDE) {
        return Ok(());
    }
    std::fs::create_dir_all(lima.join("_config"))?;
    std::fs::write(path, OVERRIDE)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::os::unix::fs::{MetadataExt, PermissionsExt};

    use super::*;

    /// A stand-in `colima` that logs its arguments, lists the containers profile as running and the
    /// machines one as stopped, and makes `ssh` empty that profile's data disk, as a trim would.
    fn fake_colima(root: &Path) -> Colima {
        let home = Home::at(root.join("home"));
        for profile in [Profile::Containers, Profile::Machines] {
            let name = format!("colima-{}", profile.name());
            let disks = home.lima().join("_disks").join(&name);
            std::fs::create_dir_all(&disks).unwrap();
            std::fs::create_dir_all(home.lima().join(&name)).unwrap();
            std::fs::write(disks.join("datadisk"), vec![1; 2 * 1024 * 1024]).unwrap();
            std::fs::write(home.lima().join(&name).join("diffdisk"), vec![1; 1024 * 1024]).unwrap();
        }
        let bin = root.join("colima");
        let script = format!(
            "#!/bin/sh\necho \"$*\" >> {log}\ncase \"$1\" in\n\
             list) echo '{{\"name\":\"containeria\",\"status\":\"Running\"}}'\n\
             echo '{{\"name\":\"containeria-machines\",\"status\":\"Stopped\"}}' ;;\n\
             ssh) : > \"$COLIMA_HOME/_lima/_disks/colima-$3/datadisk\" ;;\nesac\n",
            log = root.join("log").display()
        );
        std::fs::write(&bin, script).unwrap();
        std::fs::set_permissions(&bin, std::fs::Permissions::from_mode(0o755)).unwrap();
        Colima::at(bin, home)
    }

    #[tokio::test]
    async fn trims_only_running_profiles_and_reports_what_their_disks_gave_back() {
        let root = tempfile::tempdir().unwrap();
        let colima = fake_colima(root.path());
        let datadisk = colima.home().lima().join("_disks/colima-containeria/datadisk");
        let before = std::fs::metadata(&datadisk).unwrap().blocks() * 512;
        let machines_before = crate::storage::disk_size(colima.home(), Profile::Machines);

        assert_eq!(colima.return_free_space().await.unwrap(), before);
        let log = std::fs::read_to_string(root.path().join("log")).unwrap();
        assert_eq!(log, "list --json\nssh --profile containeria -- sudo fstrim -a\n");
        assert_eq!(crate::storage::disk_size(colima.home(), Profile::Machines), machines_before);
    }

    #[test]
    fn looks_next_to_colima_then_in_homebrew() {
        let path = search_path(Some(Path::new("/Applications/Containeria.app/Contents/MacOS")));
        assert_eq!(path[0], Path::new("/Applications/Containeria.app/Contents/MacOS"));
        assert_eq!(path[1], Path::new("/opt/homebrew/bin"));
        assert_eq!(path[2], Path::new("/usr/local/bin"));
    }

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
    fn finds_its_own_profile_among_all_instances() {
        let list = concat!(
            r#"{"name":"default","status":"Running","arch":"aarch64","cpus":2}"#,
            "\n",
            r#"{"name":"containeria","status":"Stopped","arch":"aarch64","cpus":4}"#,
            "\n",
        );
        let instance = find_instance(list, Profile::Containers).unwrap().unwrap();
        assert_eq!((instance.status, instance.cpus), (InstanceStatus::Stopped, 4));
        assert_eq!(find_instance(list, Profile::Machines).unwrap(), None);
        assert_eq!(find_instance("", Profile::Containers).unwrap(), None);
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
    fn reads_the_version_line() {
        assert_eq!(parse_version("colima version 0.10.3\ngit commit: 00f6c29\n"), "0.10.3");
    }

    #[test]
    fn reports_the_last_error_line() {
        let lines = [
            r#"time="x" level=info msg="starting colima""#,
            r#"time="x" level=fatal msg="error starting vm: disk locked""#,
        ];
        assert_eq!(last_error(lines.into_iter()), "error starting vm: disk locked");
    }

    #[test]
    fn pins_virtiofs_for_every_vm_type() {
        let lima = tempfile::tempdir().unwrap();
        pin_virtiofs(lima.path()).unwrap();
        pin_virtiofs(lima.path()).unwrap();
        let written = std::fs::read_to_string(lima.path().join("_config/override.yaml")).unwrap();
        assert_eq!(written, "mountType: virtiofs\n");
    }
}
