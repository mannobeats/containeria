use std::sync::atomic::{AtomicBool, Ordering};

use containeria_docker::Docker;
use containeria_engine::{Colima, Home};
use serde::Serialize;

use crate::error::{CommandError, ErrorKind, Result};

/// The clean-ups Docker can do.
#[derive(Debug, Clone, Copy)]
pub(crate) enum Prune {
    Containers,
    /// With `all` off, only dangling build layers go.
    Images {
        all: bool,
    },
    Volumes,
    BuildCache,
}

/// What a clean-up removed inside the engine, and what of that the Mac got back.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CleanUpReport {
    pub(crate) removed: u32,
    /// What Docker says it freed inside the VM.
    #[specta(type = specta_typescript::Number)]
    pub(crate) reclaimed_bytes: u64,
    /// How much the VM disk files shrank on the Mac after the trim.
    #[specta(type = specta_typescript::Number)]
    pub(crate) returned_bytes: u64,
    /// Why the trim failed; the clean-up itself still happened.
    pub(crate) trim_error: Option<String>,
}

/// Prunes, then trims the VMs so the freed space leaves their disk files. `colima` is `None` for
/// another Docker engine, whose disks aren't Containeria's to trim.
///
/// # Errors
/// Fails only when the prune fails; a failed trim is reported in the result.
pub(crate) async fn clean_up(
    docker: &Docker,
    colima: Option<&Colima>,
    prune: Prune,
) -> Result<CleanUpReport> {
    let report = match prune {
        Prune::Containers => docker.prune_containers().await?,
        Prune::Images { all } => docker.prune_images(all).await?,
        Prune::Volumes => docker.prune_volumes().await?,
        Prune::BuildCache => docker.prune_build_cache().await?,
    };
    let trimmed = match colima {
        Some(colima) => colima.return_free_space().await,
        None => Ok(0),
    };
    let (returned_bytes, trim_error) = match trimmed {
        Ok(bytes) => (bytes, None),
        Err(error) => {
            let message = CommandError::from(error).message;
            tracing::warn!(error = %message, "the engine's disk wasn't trimmed after a clean-up");
            (0, Some(message))
        }
    };
    Ok(CleanUpReport {
        removed: report.removed,
        reclaimed_bytes: report.reclaimed_bytes,
        returned_bytes,
        trim_error,
    })
}

/// Set while the engine's disks are being moved; nothing may start a VM until they're in place.
static MOVING: AtomicBool = AtomicBool::new(false);

/// Refuses to start a VM whose disks are mid-move or on a drive that isn't connected.
///
/// # Errors
/// Fails with a sentence saying what to do.
pub(crate) fn ensure_data_ready(home: &Home) -> Result<()> {
    if MOVING.load(Ordering::Acquire) {
        return Err(CommandError::new(
            ErrorKind::InvalidInput,
            "The engine's data is moving. It starts again by itself when the move is done.",
        ));
    }
    let location = containeria_engine::location(home);
    if !location.available {
        return Err(CommandError::new(
            ErrorKind::InvalidInput,
            format!(
                "The engine's data is in {}, which isn't connected. Connect the drive, or move the data in Settings → Storage.",
                location.path
            ),
        ));
    }
    Ok(())
}

/// Holds the moving flag for as long as it lives.
pub(crate) struct MoveGuard(());

impl MoveGuard {
    /// # Errors
    /// Fails when another move is running.
    pub(crate) fn take() -> Result<Self> {
        if MOVING.swap(true, Ordering::AcqRel) {
            return Err(CommandError::new(ErrorKind::InvalidInput, "The data is already moving."));
        }
        Ok(Self(()))
    }
}

impl Drop for MoveGuard {
    fn drop(&mut self) {
        MOVING.store(false, Ordering::Release);
    }
}

#[cfg(test)]
mod tests {
    use std::os::unix::fs::PermissionsExt;
    use std::path::{Path, PathBuf};

    use containeria_engine::Profile;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    use super::*;

    /// Every fake writes what it was asked into one log, so a test sees the order.
    fn append(log: &Path, line: &str) {
        let mut text = std::fs::read_to_string(log).unwrap_or_default();
        text.push_str(line);
        text.push('\n');
        std::fs::write(log, text).unwrap();
    }

    /// A Docker engine on a Unix socket that logs each request's path and answers every prune.
    fn fake_docker(root: &Path, log: PathBuf) -> Docker {
        const BODY: &str = r#"{"ContainersDeleted":["a"],"ImagesDeleted":[{"Deleted":"b"}],"VolumesDeleted":["c"],"CachesDeleted":["d"],"SpaceReclaimed":4096}"#;
        let socket = root.join("docker.sock");
        let listener = tokio::net::UnixListener::bind(&socket).unwrap();
        tokio::spawn(async move {
            while let Ok((mut stream, _)) = listener.accept().await {
                let mut request = Vec::new();
                let mut buffer = [0; 4096];
                while !request.windows(4).any(|window| window == b"\r\n\r\n") {
                    let read = stream.read(&mut buffer).await.unwrap();
                    request.extend_from_slice(&buffer[..read]);
                }
                let text = String::from_utf8_lossy(&request);
                let target = text.split(' ').nth(1).unwrap_or_default();
                append(&log, &format!("docker {}", target.split('?').next().unwrap_or_default()));
                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{BODY}",
                    BODY.len()
                );
                stream.write_all(response.as_bytes()).await.unwrap();
            }
        });
        Docker::connect(&socket).unwrap()
    }

    /// A stand-in `colima` listing the containers VM as running, whose `ssh` empties the data disk
    /// as a trim would, or fails like a guest whose disk can't discard.
    fn fake_colima(root: &Path, log: &Path, trim_works: bool) -> Colima {
        let home = Home::at(root.join("home"));
        let disks = home.lima().join("_disks/colima-containeria");
        std::fs::create_dir_all(&disks).unwrap();
        std::fs::write(disks.join("datadisk"), vec![1; 1024 * 1024]).unwrap();
        let ssh = if trim_works {
            ": > \"$COLIMA_HOME/_lima/_disks/colima-containeria/datadisk\""
        } else {
            "echo 'fstrim: /: the discard operation is not supported' >&2; exit 1"
        };
        let script = format!(
            "#!/bin/sh\necho \"colima $*\" >> {log}\ncase \"$1\" in\n\
             list) echo '{{\"name\":\"containeria\",\"status\":\"Running\"}}' ;;\n\
             ssh) {ssh} ;;\nesac\n",
            log = log.display()
        );
        let bin = root.join("colima");
        std::fs::write(&bin, script).unwrap();
        std::fs::set_permissions(&bin, std::fs::Permissions::from_mode(0o755)).unwrap();
        Colima::at(bin, home)
    }

    /// Under `/tmp`: macOS's per-user temp folder is too deep for a Unix socket path.
    fn short_tempdir() -> tempfile::TempDir {
        tempfile::Builder::new().tempdir_in("/tmp").unwrap()
    }

    #[tokio::test]
    async fn trims_the_engine_after_every_kind_of_clean_up() {
        let kinds = [
            (Prune::Containers, "/containers/prune"),
            (Prune::Images { all: true }, "/images/prune"),
            (Prune::Volumes, "/volumes/prune"),
            (Prune::BuildCache, "/build/prune"),
        ];
        for (prune, path) in kinds {
            let root = short_tempdir();
            let log = root.path().join("log");
            let docker = fake_docker(root.path(), log.clone());
            let colima = fake_colima(root.path(), &log, true);
            let disk = containeria_engine::disk_size(colima.home(), Profile::Containers);

            let report = clean_up(&docker, Some(&colima), prune).await.unwrap();

            assert_eq!((report.removed, report.reclaimed_bytes), (1, 4096));
            assert_eq!((report.returned_bytes, report.trim_error), (disk, None));
            let log = std::fs::read_to_string(&log).unwrap();
            let lines: Vec<&str> = log.lines().collect();
            assert!(lines[0].starts_with("docker ") && lines[0].ends_with(path), "{log}");
            let trim = ["colima list --json", "colima ssh --profile containeria -- sudo fstrim -a"];
            assert_eq!(lines[1..], trim);
        }
    }

    #[tokio::test]
    async fn keeps_the_clean_up_when_the_trim_fails() {
        let root = short_tempdir();
        let log = root.path().join("log");
        let docker = fake_docker(root.path(), log.clone());
        let colima = fake_colima(root.path(), &log, false);

        let report = clean_up(&docker, Some(&colima), Prune::Volumes).await.unwrap();

        assert_eq!((report.removed, report.reclaimed_bytes, report.returned_bytes), (1, 4096, 0));
        let error = report.trim_error.unwrap();
        assert!(error.contains("the discard operation is not supported"), "{error}");
    }

    #[tokio::test]
    async fn leaves_another_engines_disks_alone() {
        let root = short_tempdir();
        let log = root.path().join("log");
        let docker = fake_docker(root.path(), log.clone());

        let report = clean_up(&docker, None, Prune::Containers).await.unwrap();

        assert_eq!((report.returned_bytes, report.trim_error), (0, None));
        assert_eq!(std::fs::read_to_string(&log).unwrap().lines().count(), 1);
    }
}
