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
}

impl Default for Preferences {
    fn default() -> Self {
        Self { keep_running_in_menu_bar: true, memory_in_menu_bar: true, onboarded: false }
    }
}

/// `settings.json` in Containeria's home, read once and written on every change.
#[derive(Debug)]
pub(crate) struct PreferencesStore {
    path: PathBuf,
    current: RwLock<Preferences>,
}

impl PreferencesStore {
    /// Reads the file, falling back to the defaults when it's missing or unreadable.
    pub(crate) fn open(home: &Path) -> Self {
        let path = home.join("settings.json");
        let current = std::fs::read_to_string(&path)
            .ok()
            .and_then(|text| serde_json::from_str(&text).ok())
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
}
