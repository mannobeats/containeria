use std::path::{Path, PathBuf};
use std::sync::{PoisonError, RwLock};

use serde::{Deserialize, Serialize};

use crate::error::{CommandError, ErrorKind, Result};

/// App settings that aren't engine settings. Engine settings live in `colima.yaml`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Preferences {
    /// Closing the window hides it; the app stays in the menu bar.
    pub(crate) keep_running_in_menu_bar: bool,
    /// Shows the engine's memory next to the menu bar icon.
    pub(crate) memory_in_menu_bar: bool,
    /// First launch was finished or skipped.
    pub(crate) onboarded: bool,
    /// What Containeria tells you about in Notification Center.
    pub(crate) notify_on: Vec<NotifyOn>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) enum NotifyOn {
    /// A container exits with an error nobody asked for.
    Crash,
    /// A container's health check starts failing.
    Unhealthy,
    /// A pull, build or Compose run ends while Containeria isn't the frontmost app.
    Finished,
    /// The engine uses more than 90% of its memory.
    LowMemory,
}

impl Default for Preferences {
    fn default() -> Self {
        Self {
            keep_running_in_menu_bar: true,
            memory_in_menu_bar: true,
            onboarded: false,
            notify_on: vec![
                NotifyOn::Crash,
                NotifyOn::Unhealthy,
                NotifyOn::Finished,
                NotifyOn::LowMemory,
            ],
        }
    }
}

/// `settings.json` in Containeria's home, read once and written on every change.
#[derive(Debug)]
pub(crate) struct PreferencesStore {
    path: PathBuf,
    current: RwLock<Preferences>,
}

impl PreferencesStore {
    /// Reads the file, falling back to the defaults when it's missing or unreadable, and for
    /// settings added since it was written.
    pub(crate) fn open(home: &Path) -> Self {
        let path = home.join("settings.json");
        let current = std::fs::read_to_string(&path)
            .ok()
            .and_then(|text| over_defaults(&text))
            .unwrap_or_default();
        Self { path, current: RwLock::new(current) }
    }

    pub(crate) fn get(&self) -> Preferences {
        self.current.read().unwrap_or_else(PoisonError::into_inner).clone()
    }

    /// # Errors
    /// Fails when the file can't be written; the old settings stay in effect.
    pub(crate) fn set(&self, preferences: Preferences) -> Result<()> {
        let text = serde_json::to_string_pretty(&preferences)
            .map_err(|error| CommandError::new(ErrorKind::Internal, error.to_string()))?;
        if let Some(dir) = self.path.parent() {
            std::fs::create_dir_all(dir).map_err(|error| io(&error))?;
        }
        std::fs::write(&self.path, text).map_err(|error| io(&error))?;
        *self.current.write().unwrap_or_else(PoisonError::into_inner) = preferences;
        Ok(())
    }
}

fn over_defaults(text: &str) -> Option<Preferences> {
    let saved: serde_json::Map<String, serde_json::Value> = serde_json::from_str(text).ok()?;
    let mut merged = serde_json::to_value(Preferences::default()).ok()?;
    merged.as_object_mut()?.extend(saved);
    serde_json::from_value(merged).ok()
}

fn io(error: &std::io::Error) -> CommandError {
    CommandError::new(ErrorKind::Internal, format!("Settings weren't saved: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn starts_from_defaults_and_persists_changes() {
        let dir = tempfile::tempdir().unwrap();
        let store = PreferencesStore::open(dir.path());
        assert_eq!(store.get(), Preferences::default());
        let changed = Preferences { onboarded: true, ..Preferences::default() };
        store.set(changed.clone()).unwrap();
        assert_eq!(PreferencesStore::open(dir.path()).get(), changed);
    }

    #[test]
    fn a_file_from_before_a_setting_existed_keeps_what_it_has() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("settings.json"), r#"{"onboarded":true}"#).unwrap();
        let read = PreferencesStore::open(dir.path()).get();
        assert_eq!(read, Preferences { onboarded: true, ..Preferences::default() });
    }
}
