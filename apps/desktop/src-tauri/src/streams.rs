use std::collections::HashMap;
use std::future::Future;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use tokio::task::AbortHandle;

/// Long-lived streams the UI subscribed to (stats, logs, terminals). The UI cancels them by id
/// when the view unmounts; a finished stream removes itself.
#[derive(Debug, Clone, Default)]
pub(crate) struct Streams(Arc<Inner>);

#[derive(Debug, Default)]
struct Inner {
    next: AtomicU32,
    running: Mutex<HashMap<u32, AbortHandle>>,
}

impl Streams {
    pub(crate) fn spawn<F>(&self, task: F) -> u32
    where
        F: Future<Output = ()> + Send + 'static,
    {
        let id = self.0.next.fetch_add(1, Ordering::Relaxed);
        let inner = Arc::clone(&self.0);
        // Held across the spawn so a task that finishes at once can't remove itself before it's added.
        let mut running = self.0.lock();
        let handle = tauri::async_runtime::spawn(async move {
            task.await;
            inner.lock().remove(&id);
        });
        running.insert(id, handle.inner().abort_handle());
        id
    }

    pub(crate) fn cancel(&self, id: u32) {
        if let Some(handle) = self.0.lock().remove(&id) {
            handle.abort();
        }
    }
}

impl Inner {
    fn lock(&self) -> MutexGuard<'_, HashMap<u32, AbortHandle>> {
        self.running.lock().unwrap_or_else(PoisonError::into_inner)
    }
}
