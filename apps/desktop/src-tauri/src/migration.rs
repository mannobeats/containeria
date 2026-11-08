//! Finding the other Docker engines on the Mac that the import flow can copy from, by the sockets
//! they leave on disk. Nothing here runs another engine's CLI.

use std::ffi::OsStr;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// Which kind of engine a source is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) enum SourceKind {
    DockerDesktop,
    OrbStack,
    RancherDesktop,
    Colima,
    Lima,
    Podman,
}

/// One engine to copy from: an app, or one Colima profile, Lima instance or Podman machine.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MigrationSource {
    pub(crate) kind: SourceKind,
    /// The profile, instance or machine name; empty for the apps, which run one engine each.
    pub(crate) instance: Option<String>,
}

/// A source found on disk. Its socket may be stale; only a ping says it's running.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Candidate {
    pub(crate) source: MigrationSource,
    /// "Colima (default)": what the UI calls it.
    pub(crate) label: String,
    pub(crate) socket: PathBuf,
    pub(crate) installed: bool,
}

/// Where the engines keep their sockets, so tests can point everything at a temp folder.
#[derive(Debug, Clone)]
pub(crate) struct Places {
    pub(crate) home: PathBuf,
    pub(crate) applications: PathBuf,
    /// `$COLIMA_HOME`, or `~/.colima`.
    pub(crate) colima: PathBuf,
    /// `$LIMA_HOME`, or `~/.lima`.
    pub(crate) lima: PathBuf,
    /// The per-user temp folder (`$TMPDIR`), where Podman 5 forwards each machine's API.
    pub(crate) temp: PathBuf,
    /// Containeria's own Colima home and Docker socket, never offered as a source.
    pub(crate) own_colima: PathBuf,
    pub(crate) own_socket: PathBuf,
}

impl Places {
    pub(crate) fn from_env(own_colima: PathBuf, own_socket: PathBuf) -> Option<Self> {
        let home = std::env::home_dir()?;
        let or_home = |variable, folder| {
            std::env::var_os(variable).map_or_else(|| home.join(folder), PathBuf::from)
        };
        Some(Self {
            colima: or_home("COLIMA_HOME", ".colima"),
            lima: or_home("LIMA_HOME", ".lima"),
            temp: std::env::temp_dir(),
            applications: PathBuf::from("/Applications"),
            home,
            own_colima,
            own_socket,
        })
    }
}

/// The apps that run one engine each: kind, label, app bundle, socket under the home folder.
const APPS: [(SourceKind, &str, &str, &str); 3] = [
    (SourceKind::DockerDesktop, "Docker Desktop", "Docker.app", ".docker/run/docker.sock"),
    (SourceKind::OrbStack, "OrbStack", "OrbStack.app", ".orbstack/run/docker.sock"),
    (SourceKind::RancherDesktop, "Rancher Desktop", "Rancher Desktop.app", ".rd/docker.sock"),
];

/// Every source worth showing: the three apps always (installed or not), then each Colima
/// profile, Lima instance and Podman machine that has a Docker API socket. Containeria's own
/// engine is left out, so it never imports from itself.
pub(crate) fn candidates(places: &Places) -> Vec<Candidate> {
    let mut found: Vec<Candidate> = APPS
        .into_iter()
        .map(|(kind, label, app, socket)| Candidate {
            source: MigrationSource { kind, instance: None },
            label: label.to_owned(),
            socket: places.home.join(socket),
            installed: places.applications.join(app).exists(),
        })
        .collect();
    if !same_file(&places.colima, &places.own_colima) {
        found.extend(instances(SourceKind::Colima, "Colima", &places.colima, |dir| {
            Some(dir.join("docker.sock"))
        }));
    }
    found.extend(instances(SourceKind::Lima, "Lima", &places.lima, |dir| {
        Some(dir.join("sock/docker.sock"))
    }));
    found.extend(instances(SourceKind::Podman, "Podman", &places.temp.join("podman"), |entry| {
        entry.file_name()?.to_str()?.ends_with("-api.sock").then(|| entry.to_owned())
    }));
    found.retain(|candidate| !same_file(&candidate.socket, &places.own_socket));
    found
}

/// One candidate per entry of `folder` whose `socket` exists, named after the entry. Colima and
/// Lima keep their own state in `_`-prefixed folders (`_lima`, `_config`), which aren't sources.
fn instances(
    kind: SourceKind,
    label: &str,
    folder: &Path,
    socket: impl Fn(&Path) -> Option<PathBuf>,
) -> Vec<Candidate> {
    let Ok(entries) = std::fs::read_dir(folder) else { return Vec::new() };
    let mut found: Vec<Candidate> = entries
        .filter_map(|entry| {
            let path = entry.ok()?.path();
            let name = path.file_name().and_then(OsStr::to_str)?;
            if name.starts_with(['_', '.']) {
                return None;
            }
            let socket = socket(&path)?;
            // A stale socket still counts: the engine is there, just not running.
            socket.symlink_metadata().ok()?;
            let instance = name.strip_suffix("-api.sock").unwrap_or(name).to_owned();
            Some(Candidate {
                label: format!("{label} ({instance})"),
                source: MigrationSource { kind, instance: Some(instance) },
                socket,
                installed: true,
            })
        })
        .collect();
    found.sort_by(|a, b| a.label.cmp(&b.label));
    found
}

fn same_file(a: &Path, b: &Path) -> bool {
    let real = |path: &Path| std::fs::canonicalize(path).unwrap_or_else(|_| path.to_owned());
    real(a) == real(b)
}

#[cfg(test)]
mod tests {
    use std::os::unix::net::UnixListener;

    use super::*;

    /// A temp home in `/tmp`, short enough for macOS's 104-byte socket paths.
    fn places() -> (tempfile::TempDir, Places) {
        let dir = tempfile::Builder::new().tempdir_in("/tmp").unwrap();
        let root = dir.path();
        let places = Places {
            home: root.to_owned(),
            applications: root.join("Applications"),
            colima: root.join(".colima"),
            lima: root.join(".lima"),
            temp: root.join("T"),
            own_colima: root.join(".containeria/colima"),
            own_socket: root.join(".containeria/colima/containeria/docker.sock"),
        };
        (dir, places)
    }

    fn socket(path: &Path) -> UnixListener {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        UnixListener::bind(path).unwrap()
    }

    fn labels(places: &Places) -> Vec<String> {
        candidates(places)
            .into_iter()
            .filter(|candidate| candidate.installed)
            .map(|candidate| candidate.label)
            .collect()
    }

    #[test]
    fn finds_colima_profiles_lima_instances_podman_machines_and_rancher() {
        let (_dir, places) = places();
        let _sockets = [
            socket(&places.colima.join("default/docker.sock")),
            socket(&places.colima.join("work/docker.sock")),
            socket(&places.lima.join("docker/sock/docker.sock")),
            socket(&places.temp.join("podman/pm-api.sock")),
            socket(&places.home.join(".rd/docker.sock")),
        ];
        std::fs::create_dir_all(places.applications.join("Rancher Desktop.app")).unwrap();
        assert_eq!(
            labels(&places),
            [
                "Rancher Desktop",
                "Colima (default)",
                "Colima (work)",
                "Lima (docker)",
                "Podman (pm)"
            ]
        );
        let colima = candidates(&places).into_iter().find(|c| c.label == "Colima (default)");
        assert_eq!(
            colima.unwrap().source,
            MigrationSource { kind: SourceKind::Colima, instance: Some("default".to_owned()) }
        );
    }

    #[test]
    fn skips_colima_and_lima_state_folders_and_containerd_profiles() {
        let (_dir, places) = places();
        let _sockets = [
            socket(&places.colima.join("_lima/colima/ssh.sock")),
            socket(&places.lima.join("_config/docker.sock")),
        ];
        std::fs::create_dir_all(places.colima.join("k3s")).unwrap();
        std::fs::create_dir_all(places.lima.join("default/sock")).unwrap();
        assert!(labels(&places).is_empty());
    }

    #[test]
    fn never_offers_containerias_own_colima() {
        let (_dir, mut places) = places();
        let _own = socket(&places.own_colima.join("containeria-dev/docker.sock"));
        places.colima.clone_from(&places.own_colima);
        assert!(labels(&places).is_empty());
    }

    #[test]
    fn never_offers_the_socket_containeria_itself_uses() {
        let (_dir, mut places) = places();
        let _sockets = [socket(&places.colima.join("default/docker.sock"))];
        places.own_socket = places.colima.join("default/docker.sock");
        assert!(labels(&places).is_empty());
    }

    #[test]
    fn lists_docker_desktop_and_orbstack_even_when_absent() {
        let (_dir, places) = places();
        std::fs::create_dir_all(places.applications.join("OrbStack.app")).unwrap();
        let found = candidates(&places);
        assert_eq!(found.len(), 3);
        assert!(found.iter().any(|c| c.label == "OrbStack" && c.installed));
        assert!(found.iter().any(|c| c.label == "Docker Desktop" && !c.installed));
    }
}
