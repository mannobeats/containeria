//! Newer versions of Contena: looking for one, and replacing this app with it.
//!
//! A release publishes a signed archive of the app and a small file that names the newest
//! version (see docs/release.md). The app reads that file when it starts and a few times a day,
//! and installs the archive when the user says so, after checking its signature against the
//! public key in `tauri.conf.json`.

use std::time::Duration;

use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_updater::{Update, UpdaterExt};
use tauri_specta::Event;

use crate::events::UpdateAvailable;

/// Long enough after launch that the look doesn't compete with the engine starting.
const FIRST_LOOK: Duration = Duration::from_secs(20);
const LOOK_EVERY: Duration = Duration::from_hours(6);

/// A version newer than the one running.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppUpdate {
    pub(crate) version: String,
    /// What the release says about itself.
    pub(crate) notes: Option<String>,
}

/// How much of an update has been fetched.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateProgress {
    #[specta(type = specta_typescript::Number)]
    pub(crate) downloaded_bytes: u64,
    /// `None` when the server doesn't say how large the archive is.
    #[specta(type = Option<specta_typescript::Number>)]
    pub(crate) total_bytes: Option<u64>,
}

/// The update found by the last look, kept for installing it.
#[derive(Default)]
pub(crate) struct Updates {
    found: tokio::sync::Mutex<Option<Update>>,
}

impl std::fmt::Debug for Updates {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.debug_struct("Updates").finish_non_exhaustive()
    }
}

fn describe(update: &Update) -> AppUpdate {
    AppUpdate {
        version: update.version.clone(),
        notes: update.body.clone().filter(|notes| !notes.trim().is_empty()),
    }
}

impl Updates {
    /// Asks the release server for a newer version and remembers the answer.
    pub(crate) async fn look(
        &self,
        app: &AppHandle,
    ) -> tauri_plugin_updater::Result<Option<AppUpdate>> {
        let found = app.updater()?.check().await?;
        let update = found.as_ref().map(describe);
        *self.found.lock().await = found;
        Ok(update)
    }

    /// What the last look found, without asking again.
    pub(crate) async fn found(&self) -> Option<AppUpdate> {
        self.found.lock().await.as_ref().map(describe)
    }

    /// Fetches the update found, checks its signature and puts it in this app's place. The new
    /// version runs from the next launch. `Ok(false)` when no update was found.
    pub(crate) async fn install(
        &self,
        mut on_progress: impl FnMut(UpdateProgress),
    ) -> tauri_plugin_updater::Result<bool> {
        let Some(update) = self.found.lock().await.clone() else { return Ok(false) };
        let mut downloaded_bytes = 0;
        let fetched = |chunk: usize, total_bytes: Option<u64>| {
            downloaded_bytes += u64::try_from(chunk).unwrap_or(0);
            on_progress(UpdateProgress { downloaded_bytes, total_bytes });
        };
        update.download_and_install(fetched, || {}).await?;
        Ok(true)
    }
}

/// Looks for an update soon after launch and then a few times a day, and tells the windows when
/// there is one. A look that fails, as it does offline, is tried again at the next turn.
pub(crate) async fn watch(app: AppHandle, updates: std::sync::Arc<Updates>) {
    let mut wait = FIRST_LOOK;
    loop {
        tokio::time::sleep(wait).await;
        wait = LOOK_EVERY;
        match updates.look(&app).await {
            Ok(Some(update)) => {
                let _ = UpdateAvailable(update).emit(&app);
            }
            Ok(None) => {}
            Err(error) => tracing::warn!(%error, "couldn't look for an update"),
        }
    }
}
