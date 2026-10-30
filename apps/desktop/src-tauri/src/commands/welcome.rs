use std::path::Path;
use std::time::Duration;

use containeria_docker::{Docker, Inventory};
use serde::{Deserialize, Serialize};
use tauri::State;
use tauri::ipc::Channel;

use crate::error::{CommandError, ErrorKind, Result};
use crate::migration::{MigrationSource, Places, candidates};
use crate::state::AppState;

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SourceStatus {
    pub(crate) source: MigrationSource,
    /// "Colima (default)", "Docker Desktop": what to call it.
    pub(crate) label: String,
    pub(crate) installed: bool,
    /// Its engine answers, so there's something to read, and it's running next to Containeria.
    pub(crate) running: bool,
}

fn places(state: &AppState) -> Result<Places> {
    let home = state.engine.home();
    Places::from_env(home.colima(), state.engine.socket()).ok_or_else(|| {
        CommandError::new(ErrorKind::NotFound, "Containeria couldn't find your home folder.")
    })
}

/// A short wait: a socket whose engine hangs shouldn't hold up the list.
const PING_TIMEOUT: Duration = Duration::from_secs(3);

async fn connect(socket: &Path) -> Option<Docker> {
    let docker = Docker::connect(socket).ok()?;
    tokio::time::timeout(PING_TIMEOUT, docker.ping()).await.ok()?.ok()?;
    Some(docker)
}

async fn require(state: &AppState, source: &MigrationSource) -> Result<Docker> {
    let candidate = candidates(&places(state)?)
        .into_iter()
        .find(|candidate| &candidate.source == source)
        .ok_or_else(|| {
            CommandError::new(ErrorKind::NotFound, "That engine isn't on this Mac any more.")
        })?;
    connect(&candidate.socket).await.ok_or_else(|| {
        CommandError::new(
            ErrorKind::NotFound,
            format!("{} isn't running. Start it, then try again.", candidate.label),
        )
    })
}

/// Every engine on the Mac that can be copied from, and whether each is installed and running:
/// Docker Desktop, `OrbStack`, Rancher Desktop, Colima profiles, Lima instances, Podman machines.
#[tauri::command]
#[specta::specta]
pub(crate) async fn migration_sources(state: State<'_, AppState>) -> Result<Vec<SourceStatus>> {
    let found = candidates(&places(&state)?);
    let pings = futures::future::join_all(found.iter().map(|c| connect(&c.socket))).await;
    Ok(found
        .into_iter()
        .zip(pings)
        .map(|(candidate, docker)| {
            let running = docker.is_some();
            SourceStatus {
                source: candidate.source,
                label: candidate.label,
                installed: candidate.installed || running,
                running,
            }
        })
        .collect())
}

/// What the source has to bring over. Reading changes nothing there.
#[tauri::command]
#[specta::specta]
pub(crate) async fn migration_inventory(
    state: State<'_, AppState>,
    source: MigrationSource,
) -> Result<Inventory> {
    Ok(require(&state, &source).await?.inventory().await?)
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
    let from = require(&state, &source).await?;
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
