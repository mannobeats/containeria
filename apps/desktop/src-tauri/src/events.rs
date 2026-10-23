use containeria_docker::DockerEvent;

use crate::metrics::Metrics;
use crate::settings_window::SettingsPane;
use serde::{Deserialize, Serialize};

/// The engine started, stopped or changed settings; refetch its status.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, tauri_specta::Event)]
pub(crate) struct EngineChanged;

/// Something in Docker changed; refetch lists of that kind.
#[derive(Debug, Clone, Serialize, specta::Type, tauri_specta::Event)]
pub(crate) struct DockerChanged(pub(crate) DockerEvent);

/// The machines VM or a machine changed; refetch machines.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, tauri_specta::Event)]
pub(crate) struct MachinesChanged;

/// A fresh CPU and memory sample, about every two seconds while the engine runs.
#[derive(Debug, Clone, Serialize, specta::Type, tauri_specta::Event)]
pub(crate) struct MetricsUpdated(pub(crate) Metrics);

/// The native menu asks the main window to open a view, such as `/settings`.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, tauri_specta::Event)]
pub(crate) struct Navigate(pub(crate) String);

/// A menu bar command the main window carries out, such as opening a sheet.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type, tauri_specta::Event,
)]
#[serde(rename_all = "camelCase")]
pub(crate) enum MenuCommand {
    RunContainer,
    NewComposeProject,
    OpenComposeFile,
    PullImage,
    BuildImage,
    NewMachine,
    NewConnection,
    StartEngine,
    StopEngine,
    RestartEngine,
    OpenEngineShell,
    ShowShortcuts,
    CollectDiagnostics,
}

/// Something in the Kubernetes cluster changed, or it came or went; refetch the cluster.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, tauri_specta::Event)]
pub(crate) struct KubeChanged;

/// Switches the open Settings window to a pane.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, tauri_specta::Event)]
pub(crate) struct SettingsPaneShown(pub(crate) SettingsPane);

/// Settings changed, possibly in another window.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, tauri_specta::Event)]
pub(crate) struct PreferencesChanged;
