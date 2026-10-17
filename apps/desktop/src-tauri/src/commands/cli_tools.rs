use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::error::{CommandError, ErrorKind, Result};

/// Where command-line tools go so every shell finds them, as Docker Desktop installs them.
const BIN: &str = "/usr/local/bin";
const PLUGINS: &str = "/usr/local/lib/docker/cli-plugins";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ToolState {
    /// Linked to Containeria's copy.
    Installed,
    Missing,
    /// Something else is there, such as Homebrew's or Docker Desktop's; Containeria leaves it.
    Other,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CliTool {
    pub(crate) name: String,
    pub(crate) target: String,
    pub(crate) state: ToolState,
}

/// Each tool Containeria can put on the `PATH`: (name, its copy here, where it goes).
fn sources(app: &AppHandle) -> Vec<(String, PathBuf, PathBuf)> {
    let mut sources = Vec::new();
    if let Some(cx) = std::env::current_exe().ok().and_then(|exe| Some(exe.parent()?.join("cx"))) {
        sources.push(("cx".to_owned(), cx, Path::new(BIN).join("cx")));
    }
    if let Ok(tools) = app.path().resource_dir().map(|dir| dir.join("tools")) {
        sources.push(("cx".to_owned(), tools.join("bin/cx"), Path::new(BIN).join("cx")));
        for name in ["docker", "kubectl"] {
            sources.push((
                name.to_owned(),
                tools.join("bin").join(name),
                Path::new(BIN).join(name),
            ));
        }
        for name in ["docker-compose", "docker-buildx"] {
            sources.push((
                name.to_owned(),
                tools.join("cli-plugins").join(name),
                Path::new(PLUGINS).join(name),
            ));
        }
    }
    let mut seen = std::collections::HashSet::new();
    sources.retain(|(name, source, _)| source.is_file() && seen.insert(name.clone()));
    sources
}

fn state(source: &Path, target: &Path) -> ToolState {
    match std::fs::read_link(target) {
        Ok(linked) if linked == source => ToolState::Installed,
        Ok(_) => ToolState::Other,
        Err(_) if target.exists() => ToolState::Other,
        Err(_) => ToolState::Missing,
    }
}

/// The tools Containeria can install, and whether each one is.
#[tauri::command]
#[specta::specta]
pub(crate) async fn cli_tools(app: AppHandle) -> Result<Vec<CliTool>> {
    Ok(sources(&app)
        .into_iter()
        .map(|(name, source, target)| CliTool {
            state: state(&source, &target),
            target: target.to_string_lossy().into_owned(),
            name,
        })
        .collect())
}

/// Quotes `path` for a POSIX shell.
fn quoted(path: &Path) -> String {
    format!("'{}'", path.to_string_lossy().replace('\'', r"'\''"))
}

/// Links every missing tool into `/usr/local` after the macOS administrator prompt. Tools already
/// there from somewhere else are left alone.
#[tauri::command]
#[specta::specta]
pub(crate) async fn cli_tools_install(app: AppHandle) -> Result<()> {
    let links: Vec<String> = sources(&app)
        .into_iter()
        .filter(|(_, source, target)| state(source, target) == ToolState::Missing)
        .map(|(_, source, target)| format!("/bin/ln -sf {} {}", quoted(&source), quoted(&target)))
        .collect();
    if links.is_empty() {
        return Ok(());
    }
    let shell = format!("/bin/mkdir -p {BIN} {PLUGINS} && {}", links.join(" && "));
    containeria_net::privileged(
        "Installing command-line tools",
        &shell,
        "Containeria wants to add its command-line tools to /usr/local.",
    )
    .await
    .map_err(|error| match error {
        containeria_net::Error::Cancelled => {
            CommandError::new(ErrorKind::Cancelled, error.to_string())
        }
        other => CommandError::new(ErrorKind::Internal, other.to_string()),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn leaves_tools_it_did_not_install() {
        let dir = tempfile::tempdir().unwrap();
        let ours = dir.path().join("ours");
        std::fs::write(&ours, "").unwrap();
        let target = dir.path().join("docker");
        assert_eq!(state(&ours, &target), ToolState::Missing);
        std::os::unix::fs::symlink(&ours, &target).unwrap();
        assert_eq!(state(&ours, &target), ToolState::Installed);
        std::fs::remove_file(&target).unwrap();
        std::fs::write(&target, "homebrew's").unwrap();
        assert_eq!(state(&ours, &target), ToolState::Other);
    }

    #[test]
    fn quotes_paths_for_the_shell() {
        assert_eq!(quoted(Path::new("/A B/it's")), r"'/A B/it'\''s'");
    }
}
