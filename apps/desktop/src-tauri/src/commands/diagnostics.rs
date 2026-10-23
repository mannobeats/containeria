use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

use containeria_engine::{Host, Profile};
use flate2::Compression;
use flate2::write::GzEncoder;
use serde::Serialize;
use tauri::{AppHandle, State};

use crate::error::{CommandError, ErrorKind, Result};
use crate::state::AppState;

/// The end of a long log is what explains a failure; the start is boot noise.
const LOG_TAIL_BYTES: u64 = 2 * 1024 * 1024;

/// Lima's logs of each VM, by file name inside the instance folder.
const VM_LOGS: [&str; 4] = ["ha.stderr.log", "ha.stdout.log", "serialv.log", "serial.log"];

/// What the bundle says about the Mac and the engine. Container settings are left out: their
/// environment often holds passwords.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Summary {
    app_version: String,
    host: Option<Host>,
    colima_version: Option<String>,
    engine: Option<serde_json::Value>,
    machines: Option<serde_json::Value>,
    docker: Option<serde_json::Value>,
    containers: Vec<ContainerLine>,
    data_location: containeria_engine::DataLocation,
}

#[derive(Debug, Serialize)]
struct ContainerLine {
    name: String,
    image: String,
    state: String,
    status: String,
}

async fn summary(app: &AppHandle, state: &AppState) -> Summary {
    let docker = state.engine.docker().await.ok();
    let info = match &docker {
        Some(docker) => docker.info().await.ok().and_then(|info| serde_json::to_value(info).ok()),
        None => None,
    };
    let containers = match &docker {
        Some(docker) => docker.containers().await.unwrap_or_default(),
        None => Vec::new(),
    };
    Summary {
        app_version: app.package_info().version.to_string(),
        host: Host::detect().await.ok(),
        colima_version: state.engine.colima_version().await,
        engine: state
            .engine
            .status()
            .await
            .ok()
            .and_then(|status| serde_json::to_value(status).ok()),
        machines: state
            .machines
            .status()
            .await
            .ok()
            .and_then(|status| serde_json::to_value(status).ok()),
        docker: info,
        containers: containers
            .into_iter()
            .map(|container| ContainerLine {
                name: container.name,
                image: container.image,
                state: format!("{:?}", container.state).to_lowercase(),
                status: container.status,
            })
            .collect(),
        data_location: containeria_engine::location(state.engine.home()),
    }
}

/// The last `LOG_TAIL_BYTES` of a file.
fn tail(path: &Path) -> std::io::Result<Vec<u8>> {
    let mut file = std::fs::File::open(path)?;
    let length = file.metadata()?.len();
    file.seek(SeekFrom::Start(length.saturating_sub(LOG_TAIL_BYTES)))?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes)?;
    Ok(bytes)
}

fn add(
    archive: &mut tar::Builder<GzEncoder<std::fs::File>>,
    name: &str,
    bytes: &[u8],
) -> std::io::Result<()> {
    let mut header = tar::Header::new_gnu();
    header.set_size(bytes.len() as u64);
    header.set_mode(0o644);
    header.set_mtime(
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |since| since.as_secs()),
    );
    header.set_cksum();
    archive.append_data(&mut header, name, bytes)
}

/// The files a bundle holds, by their name inside it.
fn files(state: &AppState) -> Vec<(String, PathBuf)> {
    let home = state.engine.home();
    let mut files = Vec::new();
    for profile in [Profile::Containers, Profile::Machines] {
        files.push((format!("colima/{}.yaml", profile.name()), home.config_file(profile)));
        let instance = home.lima().join(format!("colima-{}", profile.name()));
        for log in VM_LOGS {
            files.push((format!("lima/{}/{log}", profile.name()), instance.join(log)));
        }
    }
    files
}

/// Writes a `.tar.gz` of what helps someone else find a problem: versions, engine and machine
/// status, container names and states, engine settings and the VMs' logs.
#[tauri::command]
#[specta::specta]
pub(crate) async fn diagnostics_collect(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
) -> Result<()> {
    let summary = serde_json::to_vec_pretty(&summary(&app, &state).await)
        .map_err(|error| CommandError::new(ErrorKind::Internal, error.to_string()))?;
    let files = files(&state);
    let target = PathBuf::from(path);
    tauri::async_runtime::spawn_blocking(move || -> std::io::Result<()> {
        let encoder = GzEncoder::new(std::fs::File::create(&target)?, Compression::default());
        let mut archive = tar::Builder::new(encoder);
        add(&mut archive, "containeria-diagnostics/summary.json", &summary)?;
        for (name, file) in files {
            if let Ok(bytes) = tail(&file) {
                add(&mut archive, &format!("containeria-diagnostics/{name}"), &bytes)?;
            }
        }
        archive.into_inner()?.finish()?;
        Ok(())
    })
    .await
    .map_err(|error| CommandError::new(ErrorKind::Internal, error.to_string()))?
    .map_err(|error| {
        CommandError::new(ErrorKind::Internal, format!("The bundle couldn't be written: {error}"))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_only_the_end_of_a_long_log() {
        let dir = tempfile::tempdir().unwrap();
        let log = dir.path().join("ha.stderr.log");
        let mut text = vec![b'a'; usize::try_from(LOG_TAIL_BYTES).unwrap()];
        text.extend_from_slice(b"the line that explains it");
        std::fs::write(&log, &text).unwrap();
        let kept = tail(&log).unwrap();
        assert_eq!(kept.len() as u64, LOG_TAIL_BYTES);
        assert!(kept.ends_with(b"the line that explains it"));
    }
}
