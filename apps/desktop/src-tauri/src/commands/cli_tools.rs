use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::error::{CommandError, ErrorKind, Result};

/// Where command-line tools go so every shell finds them, as Docker Desktop installs them.
const BIN: &str = "/usr/local/bin";
const PLUGINS: &str = "/usr/local/lib/docker/cli-plugins";
/// Where Homebrew puts the same tools on Apple silicon.
const HOMEBREW_BIN: &str = "/opt/homebrew/bin";
/// The other folder Docker always looks for plugins in, besides `PLUGINS` and the user's own.
const PLUGINS_LIBEXEC: &str = "/usr/local/libexec/docker/cli-plugins";

/// One install at a time: a second one, started from another window while the first waits for
/// the password, would ask for it again to make the same links.
static INSTALLING: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ToolState {
    /// Linked to Contena's copy.
    Installed,
    /// A terminal doesn't find the tool at all.
    Missing,
    /// The user has a copy of their own, such as Homebrew's or Docker Desktop's; Contena
    /// leaves it.
    Other,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CliTool {
    pub(crate) name: String,
    pub(crate) target: String,
    pub(crate) state: ToolState,
}

/// Each tool Contena can put on the `PATH`: (name, its copy here, where it goes).
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

/// The folders Docker loads plugins from besides `PLUGINS`: the user's own, the second system
/// one, and those their Docker settings name, which is how a Homebrew plugin is found.
fn plugin_folders(home: &Path, docker_settings: &str) -> Vec<PathBuf> {
    let settings: serde_json::Value = serde_json::from_str(docker_settings).unwrap_or_default();
    let named = settings["cliPluginsExtraDirs"].as_array().cloned().unwrap_or_default();
    [home.join(".docker/cli-plugins"), PathBuf::from(PLUGINS_LIBEXEC)]
        .into_iter()
        .chain(named.iter().filter_map(|folder| folder.as_str().map(PathBuf::from)))
        .collect()
}

/// The other places a terminal or Docker finds the tool that goes to `target`.
fn elsewhere(target: &Path) -> Vec<PathBuf> {
    let Some(name) = target.file_name() else { return Vec::new() };
    if !target.starts_with(PLUGINS) {
        return vec![Path::new(HOMEBREW_BIN).join(name)];
    }
    let home = std::env::home_dir().unwrap_or_default();
    let settings = std::fs::read_to_string(home.join(".docker/config.json")).unwrap_or_default();
    plugin_folders(&home, &settings).into_iter().map(|folder| folder.join(name)).collect()
}

fn state(source: &Path, target: &Path, elsewhere: &[PathBuf]) -> ToolState {
    match std::fs::read_link(target) {
        Ok(linked) if linked == source => ToolState::Installed,
        Ok(_) => ToolState::Other,
        // Whatever is at the target is the user's and stays. Elsewhere only a file counts: a
        // folder of that name runs nothing.
        Err(_) if target.exists() || elsewhere.iter().any(|copy| copy.is_file()) => {
            ToolState::Other
        }
        Err(_) => ToolState::Missing,
    }
}

/// The tools Contena can install, and whether each one is.
#[tauri::command]
#[specta::specta]
pub(crate) async fn cli_tools(app: AppHandle) -> Result<Vec<CliTool>> {
    Ok(sources(&app)
        .into_iter()
        .map(|(name, source, target)| CliTool {
            state: state(&source, &target, &elsewhere(&target)),
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
    let _installing = INSTALLING.lock().await;
    let links: Vec<String> = sources(&app)
        .into_iter()
        .filter(|(_, source, target)| {
            state(source, target, &elsewhere(target)) == ToolState::Missing
        })
        .map(|(_, source, target)| format!("/bin/ln -sf {} {}", quoted(&source), quoted(&target)))
        .collect();
    if links.is_empty() {
        return Ok(());
    }
    let shell = format!("/bin/mkdir -p {BIN} {PLUGINS} && {}", links.join(" && "));
    contena_net::privileged(
        "Installing command-line tools",
        &shell,
        "Contena wants to add its command-line tools to /usr/local.",
    )
    .await
    .map_err(|error| match error {
        contena_net::Error::Cancelled => CommandError::new(ErrorKind::Cancelled, error.to_string()),
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
        assert_eq!(state(&ours, &target, &[]), ToolState::Missing);
        std::os::unix::fs::symlink(&ours, &target).unwrap();
        assert_eq!(state(&ours, &target, &[]), ToolState::Installed);
        std::fs::remove_file(&target).unwrap();
        std::fs::write(&target, "docker desktop's").unwrap();
        assert_eq!(state(&ours, &target, &[]), ToolState::Other);
    }

    #[test]
    fn a_tool_the_user_has_elsewhere_is_not_missing() {
        let dir = tempfile::tempdir().unwrap();
        let ours = dir.path().join("ours");
        std::fs::write(&ours, "").unwrap();
        let homebrews = dir.path().join("homebrew-docker");
        let target = dir.path().join("docker");
        assert_eq!(state(&ours, &target, std::slice::from_ref(&homebrews)), ToolState::Missing);
        std::fs::create_dir(&homebrews).unwrap();
        assert_eq!(state(&ours, &target, std::slice::from_ref(&homebrews)), ToolState::Missing);
        std::fs::remove_dir(&homebrews).unwrap();
        std::fs::write(&homebrews, "").unwrap();
        assert_eq!(state(&ours, &target, &[homebrews]), ToolState::Other);
    }

    #[test]
    fn looks_for_a_users_own_docker_where_homebrew_keeps_it() {
        assert_eq!(
            elsewhere(Path::new("/usr/local/bin/docker")),
            [PathBuf::from("/opt/homebrew/bin/docker")]
        );
    }

    #[test]
    fn a_homebrew_plugin_counts_only_when_docker_is_told_of_its_folder() {
        let home = Path::new("/Users/ada");
        let homebrew = PathBuf::from("/opt/homebrew/lib/docker/cli-plugins");
        let untold = plugin_folders(home, r#"{"currentContext":"contena"}"#);
        assert_eq!(
            untold,
            [
                PathBuf::from("/Users/ada/.docker/cli-plugins"),
                PathBuf::from("/usr/local/libexec/docker/cli-plugins")
            ]
        );
        let told = r#"{"cliPluginsExtraDirs":["/opt/homebrew/lib/docker/cli-plugins"]}"#;
        assert!(plugin_folders(home, told).contains(&homebrew));
        assert_eq!(plugin_folders(home, "not json").len(), 2);
    }

    #[test]
    fn quotes_paths_for_the_shell() {
        assert_eq!(quoted(Path::new("/A B/it's")), r"'/A B/it'\''s'");
    }
}
