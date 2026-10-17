use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::Result;
use crate::files::{read_json, write_json};

/// Keep this many statements in the history, newest first.
const HISTORY_LIMIT: usize = 300;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub id: String,
    pub connection_id: String,
    pub connection_name: String,
    pub sql: String,
    pub at_ms: f64,
    pub elapsed_ms: f64,
    pub rows: Option<u32>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SavedQuery {
    pub id: String,
    pub name: String,
    pub connection_id: Option<String>,
    pub sql: String,
}

/// Query history and saved queries, as JSON files in the data folder.
#[derive(Debug, Clone)]
pub(crate) struct HistoryStore {
    history: PathBuf,
    saved: PathBuf,
}

impl HistoryStore {
    #[must_use]
    pub(crate) fn new(folder: &Path) -> Self {
        Self { history: folder.join("history.json"), saved: folder.join("saved-queries.json") }
    }

    /// # Errors
    /// Fails when the file exists but can't be read.
    pub(crate) fn history(&self) -> Result<Vec<HistoryEntry>> {
        read_json(&self.history)
    }

    /// # Errors
    /// Fails when the file can't be written.
    pub(crate) fn record(&self, entry: HistoryEntry) -> Result<()> {
        let mut entries = self.history()?;
        entries.insert(0, entry);
        entries.truncate(HISTORY_LIMIT);
        write_json(&self.history, &entries)
    }

    /// # Errors
    /// Fails when the file exists but can't be read.
    pub(crate) fn saved(&self) -> Result<Vec<SavedQuery>> {
        read_json(&self.saved)
    }

    /// Adds a query, or replaces the one with the same id.
    ///
    /// # Errors
    /// Fails when the file can't be written.
    pub(crate) fn save(&self, query: SavedQuery) -> Result<()> {
        let mut saved = self.saved()?;
        match saved.iter_mut().find(|existing| existing.id == query.id) {
            Some(existing) => *existing = query,
            None => saved.push(query),
        }
        saved.sort_by_key(|query| query.name.to_lowercase());
        write_json(&self.saved, &saved)
    }

    /// # Errors
    /// Fails when the file can't be written.
    pub(crate) fn unsave(&self, id: &str) -> Result<()> {
        let mut saved = self.saved()?;
        saved.retain(|query| query.id != id);
        write_json(&self.saved, &saved)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(id: &str) -> HistoryEntry {
        HistoryEntry {
            id: id.into(),
            connection_id: "c".into(),
            connection_name: "shop".into(),
            sql: "select 1".into(),
            at_ms: 0.0,
            elapsed_ms: 1.0,
            rows: Some(1),
            error: None,
        }
    }

    #[test]
    fn keeps_the_newest_history_first_and_caps_it() {
        let folder = tempfile::tempdir().unwrap();
        let store = HistoryStore::new(folder.path());
        for index in 0..HISTORY_LIMIT + 5 {
            store.record(entry(&index.to_string())).unwrap();
        }
        let history = store.history().unwrap();
        assert_eq!(history.len(), HISTORY_LIMIT);
        assert_eq!(history[0].id, (HISTORY_LIMIT + 4).to_string());
    }

    #[test]
    fn saves_sorts_replaces_and_removes_queries() {
        let folder = tempfile::tempdir().unwrap();
        let store = HistoryStore::new(folder.path());
        let query = |id: &str, name: &str| SavedQuery {
            id: id.into(),
            name: name.into(),
            connection_id: None,
            sql: "select 1".into(),
        };
        store.save(query("1", "zeta")).unwrap();
        store.save(query("2", "Alpha")).unwrap();
        store.save(query("1", "beta")).unwrap();
        assert_eq!(
            store.saved().unwrap().iter().map(|query| query.name.as_str()).collect::<Vec<_>>(),
            ["Alpha", "beta"]
        );
        store.unsave("2").unwrap();
        assert_eq!(store.saved().unwrap().len(), 1);
    }
}
