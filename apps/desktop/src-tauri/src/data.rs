use std::collections::HashMap;
use std::future::Future;
use std::path::Path;
use std::sync::{Mutex, PoisonError};

use containeria_data::Data;
use tokio::task::AbortHandle;

use crate::error::{CommandError, ErrorKind, Result};

/// The database browser plus the editor queries that are running, so the UI can stop one.
#[derive(Debug)]
pub(crate) struct DataState {
    pub(crate) data: Data,
    running: Mutex<HashMap<String, AbortHandle>>,
}

impl DataState {
    pub(crate) fn new(folder: &Path) -> Self {
        Self { data: Data::new(folder), running: Mutex::new(HashMap::new()) }
    }

    /// Runs `work` as a task the UI can cancel by `run_id`.
    pub(crate) async fn cancellable<T, F>(&self, run_id: String, work: F) -> Result<T>
    where
        T: Send + 'static,
        F: Future<Output = Result<T>> + Send + 'static,
    {
        let task = tauri::async_runtime::spawn(work);
        self.lock().insert(run_id.clone(), task.inner().abort_handle());
        let outcome = task.await;
        self.lock().remove(&run_id);
        match outcome {
            Ok(result) => result,
            Err(tauri::Error::JoinError(error)) if error.is_cancelled() => {
                Err(CommandError::new(ErrorKind::Cancelled, "The query was stopped."))
            }
            Err(error) => Err(CommandError::new(ErrorKind::Internal, error.to_string())),
        }
    }

    pub(crate) fn cancel(&self, run_id: &str) {
        if let Some(handle) = self.lock().remove(run_id) {
            handle.abort();
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, AbortHandle>> {
        self.running.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn reports_a_crashed_query_as_a_failure_not_a_stop() {
        let folder = tempfile::tempdir().unwrap();
        let state = DataState::new(folder.path());
        let error = state
            .cancellable::<(), _>("run".into(), async { panic!("the driver crashed") })
            .await
            .unwrap_err();
        assert_eq!(error.kind, ErrorKind::Internal);
    }
}
