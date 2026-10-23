use std::path::Path;

use containeria_docker::{Docker, Inventory};
use serde::{Deserialize, Serialize};
use tauri::State;
use tauri::ipc::Channel;

use crate::error::{CommandError, ErrorKind, Result};
use crate::state::AppState;

/// Another container app on the Mac whose images, volumes and containers can be brought over.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) enum MigrationSource {
    DockerDesktop,
    OrbStack,
}

impl MigrationSource {
    const ALL: [Self; 2] = [Self::DockerDesktop, Self::OrbStack];

    const fn app(self) -> &'static str {
        match self {
            Self::DockerDesktop => "/Applications/Docker.app",
            Self::OrbStack => "/Applications/OrbStack.app",
        }
    }

    /// Where its engine listens, under the home folder.
    const fn socket(self) -> &'static str {
        match self {
            Self::DockerDesktop => ".docker/run/docker.sock",
            Self::OrbStack => ".orbstack/run/docker.sock",
        }
    }

    const fn label(self) -> &'static str {
        match self {
            Self::DockerDesktop => "Docker Desktop",
            Self::OrbStack => "OrbStack",
        }
    }

    async fn connect(self) -> Option<Docker> {
        let socket = std::env::home_dir()?.join(self.socket());
        let docker = Docker::connect(&socket).ok()?;
        docker.ping().await.ok()?;
        Some(docker)
    }

    async fn require(self) -> Result<Docker> {
        self.connect().await.ok_or_else(|| {
            CommandError::new(
                ErrorKind::NotFound,
                format!("{} isn't running. Open it, then try again.", self.label()),
            )
        })
    }
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SourceStatus {
    pub(crate) source: MigrationSource,
    pub(crate) installed: bool,
    /// Its engine answers, so there's something to read.
    pub(crate) running: bool,
}

/// Whether Docker Desktop and `OrbStack` are installed and running.
#[tauri::command]
#[specta::specta]
pub(crate) async fn migration_sources() -> Result<Vec<SourceStatus>> {
    let mut sources = Vec::new();
    for source in MigrationSource::ALL {
        let running = source.connect().await.is_some();
        let installed = running || Path::new(source.app()).exists();
        sources.push(SourceStatus { source, installed, running });
    }
    Ok(sources)
}

/// What the source has to bring over. Reading changes nothing there.
#[tauri::command]
#[specta::specta]
pub(crate) async fn migration_inventory(source: MigrationSource) -> Result<Inventory> {
    Ok(source.require().await?.inventory().await?)
}

/// What to bring over, by image reference, volume name and container ID.
#[derive(Debug, Clone, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MigrationPlan {
    pub(crate) images: Vec<String>,
    pub(crate) volumes: Vec<String>,
    pub(crate) containers: Vec<String>,
    /// Start the containers that were running there.
    pub(crate) start: bool,
}

#[derive(Debug, Clone, Copy, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ItemKind {
    Image,
    Volume,
    Container,
}

#[derive(Debug, Clone, Copy, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ImportState {
    Copying,
    Done,
    Failed,
}

/// One item's progress: `item` is the reference, name or ID it was asked for by.
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ImportProgress {
    pub(crate) kind: ItemKind,
    pub(crate) item: String,
    pub(crate) state: ImportState,
    pub(crate) message: Option<String>,
}

/// Brings images, then volumes, then containers over, one at a time, reporting each. A failed
/// item is reported and skipped; the rest still copy. The source isn't changed, apart from the
/// short-lived helper containers that read its volumes.
#[tauri::command]
#[specta::specta]
pub(crate) async fn migration_import(
    state: State<'_, AppState>,
    source: MigrationSource,
    plan: MigrationPlan,
    progress: Channel<ImportProgress>,
) -> Result<()> {
    let from = source.require().await?;
    let to = state.engine.docker().await?;
    let report = |kind, item: &str, state, message: Option<String>| {
        let _ = progress.send(ImportProgress { kind, item: item.to_owned(), state, message });
    };
    let finish = |kind, item: &str, result: containeria_docker::Result<()>| match result {
        Ok(()) => report(kind, item, ImportState::Done, None),
        Err(error) => report(kind, item, ImportState::Failed, Some(error.to_string())),
    };
    for reference in &plan.images {
        report(ItemKind::Image, reference, ImportState::Copying, None);
        finish(ItemKind::Image, reference, from.copy_image_to(&to, reference).await);
    }
    for volume in &plan.volumes {
        report(ItemKind::Volume, volume, ImportState::Copying, None);
        finish(ItemKind::Volume, volume, from.copy_volume_to(&to, volume).await);
    }
    for id in &plan.containers {
        report(ItemKind::Container, id, ImportState::Copying, None);
        let copied = from.copy_container_to(&to, id, plan.start).await.map(drop);
        finish(ItemKind::Container, id, copied);
    }
    Ok(())
}
