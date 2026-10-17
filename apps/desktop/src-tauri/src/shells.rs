use std::collections::HashMap;
use std::fmt;
use std::pin::Pin;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use containeria_docker::ShellTarget;
use tokio::io::{AsyncWrite, AsyncWriteExt};

type Input = Arc<tokio::sync::Mutex<Pin<Box<dyn AsyncWrite + Send>>>>;

/// The keyboard side of open terminals, keyed by the id of the stream carrying their output.
#[derive(Clone, Default)]
pub(crate) struct Shells(Arc<Mutex<HashMap<u32, (ShellTarget, Input)>>>);

impl fmt::Debug for Shells {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.debug_struct("Shells").field("open", &self.lock().len()).finish()
    }
}

impl Shells {
    pub(crate) fn open(
        &self,
        id: u32,
        target: ShellTarget,
        input: Pin<Box<dyn AsyncWrite + Send>>,
    ) {
        self.lock().insert(id, (target, Arc::new(tokio::sync::Mutex::new(input))));
    }

    pub(crate) fn close(&self, id: u32) {
        self.lock().remove(&id);
    }

    pub(crate) fn target(&self, id: u32) -> Option<ShellTarget> {
        self.lock().get(&id).map(|(target, _)| target.clone())
    }

    /// Types `text` into the shell. Returns `false` when it has already closed.
    pub(crate) async fn write(&self, id: u32, text: &str) -> std::io::Result<bool> {
        let Some(input) = self.lock().get(&id).map(|(_, input)| Arc::clone(input)) else {
            return Ok(false);
        };
        let mut input = input.lock().await;
        input.write_all(text.as_bytes()).await?;
        input.flush().await?;
        Ok(true)
    }

    fn lock(&self) -> MutexGuard<'_, HashMap<u32, (ShellTarget, Input)>> {
        self.0.lock().unwrap_or_else(PoisonError::into_inner)
    }
}
