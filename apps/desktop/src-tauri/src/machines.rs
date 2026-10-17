use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex, MutexGuard, OnceLock, PoisonError};

use containeria_engine::{Colima, EngineConfig, Home, Instance, LogLine, Profile};
use containeria_machines::{Incus, Shell, ShellInput};
use futures::StreamExt;
use serde::Serialize;
use tauri::AppHandle;
use tauri_specta::Event;
use tokio::sync::mpsc;

use crate::engine::{EnginePhase, phase_of};
use crate::error::{CommandError, ErrorKind, Result};
use crate::events::MachinesChanged;
use crate::streams::Streams;

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MachinesStatus {
    pub(crate) phase: EnginePhase,
    pub(crate) instance: Option<Instance>,
    /// Full VMs need nested virtualization: an M3 or newer Mac on macOS 15 or newer.
    pub(crate) supports_vms: bool,
}

type ShellInputs = Arc<Mutex<HashMap<u32, mpsc::Sender<ShellInput>>>>;

/// The machines profile: a second Colima VM running Incus, created with the first machine.
#[derive(Debug)]
pub(crate) struct MachinesEngine {
    home: Home,
    colima: Option<Colima>,
    supports_vms: bool,
    transition: Mutex<Option<EnginePhase>>,
    shells: ShellInputs,
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

impl MachinesEngine {
    pub(crate) fn new(home: Home, bundled_colima: Option<&Path>) -> Self {
        Self {
            colima: Colima::locate(home.clone(), bundled_colima).ok(),
            home,
            supports_vms: containeria_engine::supports_nested_virtualization(),
            transition: Mutex::new(None),
            shells: ShellInputs::default(),
        }
    }

    pub(crate) async fn status(&self) -> Result<MachinesStatus> {
        let supports_vms = self.supports_vms;
        let Some(colima) = &self.colima else {
            return Ok(MachinesStatus {
                phase: EnginePhase::Missing,
                instance: None,
                supports_vms,
            });
        };
        let instance = colima.instance(Profile::Machines).await?;
        let phase = phase_of(*lock(&self.transition), instance.as_ref());
        Ok(MachinesStatus { phase, instance, supports_vms })
    }

    /// Starts the machines VM, writing its `colima.yaml` from the engine settings the first time.
    pub(crate) async fn start(
        &self,
        app: &AppHandle,
        settings: &EngineConfig,
        on_line: impl FnMut(LogLine),
    ) -> Result<()> {
        let colima = self.colima()?;
        crate::storage::ensure_data_ready(&self.home)?;
        let path = self.home.config_file(Profile::Machines);
        if EngineConfig::load(&path)?.is_none() {
            settings.save_machines(&path, self.supports_vms)?;
        }
        self.transition_while(app, EnginePhase::Starting, colima.start(Profile::Machines, on_line))
            .await
    }

    pub(crate) async fn stop(&self, app: &AppHandle, on_line: impl FnMut(LogLine)) -> Result<()> {
        let colima = self.colima()?;
        self.transition_while(app, EnginePhase::Stopping, colima.stop(Profile::Machines, on_line))
            .await
    }

    async fn transition_while(
        &self,
        app: &AppHandle,
        phase: EnginePhase,
        work: impl Future<Output = containeria_engine::Result<()>>,
    ) -> Result<()> {
        *lock(&self.transition) = Some(phase);
        MachinesChanged.emit(app)?;
        let result = work.await;
        *lock(&self.transition) = None;
        MachinesChanged.emit(app)?;
        Ok(result?)
    }

    /// The Incus API, if the machines VM answers.
    ///
    /// # Errors
    /// Fails with `EngineStopped` when it doesn't.
    pub(crate) async fn incus(&self) -> Result<Incus> {
        let incus = Incus::new(self.home.incus_socket());
        incus.ping().await.map_err(|_| {
            CommandError::new(ErrorKind::EngineStopped, "Linux machines aren't running.")
        })?;
        Ok(incus)
    }

    fn colima(&self) -> Result<&Colima> {
        self.colima
            .as_ref()
            .ok_or_else(|| CommandError::new(ErrorKind::EngineMissing, "Colima isn't installed."))
    }

    /// Streams a shell's output as text until it exits; input goes through `send` with the id.
    pub(crate) fn attach(
        &self,
        streams: &Streams,
        shell: Shell,
        mut on_output: impl FnMut(String) + Send + 'static,
    ) -> u32 {
        let id_slot = Arc::new(OnceLock::new());
        let guard = Detach { shells: Arc::clone(&self.shells), id: Arc::clone(&id_slot) };
        let Shell { input, mut output } = shell;
        // Held across the spawn so a shell that exits at once can't detach before it's attached.
        let mut shells = lock(&self.shells);
        let id = streams.spawn(async move {
            let _guard = guard;
            let mut decoder = Utf8Decoder::default();
            while let Some(bytes) = output.next().await {
                let text = decoder.push(&bytes);
                if !text.is_empty() {
                    on_output(text);
                }
            }
        });
        let _ = id_slot.set(id);
        shells.insert(id, input);
        id
    }

    /// Sends keystrokes or a resize to an attached shell. A shell that has exited ignores it.
    pub(crate) async fn send(&self, id: u32, input: ShellInput) {
        let sender = lock(&self.shells).get(&id).cloned();
        if let Some(sender) = sender {
            let _ = sender.send(input).await;
        }
    }
}

/// Forgets a shell's input when its output stream ends or is cancelled, which closes the shell.
struct Detach {
    shells: ShellInputs,
    id: Arc<OnceLock<u32>>,
}

impl Drop for Detach {
    fn drop(&mut self) {
        if let Some(id) = self.id.get() {
            lock(&self.shells).remove(id);
        }
    }
}

/// Turns terminal bytes into text without splitting a character that spans two chunks.
#[derive(Debug, Default)]
struct Utf8Decoder {
    pending: Vec<u8>,
}

impl Utf8Decoder {
    fn push(&mut self, bytes: &[u8]) -> String {
        self.pending.extend_from_slice(bytes);
        let valid = match std::str::from_utf8(&self.pending) {
            Ok(_) => self.pending.len(),
            Err(error) if error.error_len().is_none() => error.valid_up_to(),
            Err(_) => {
                let text = String::from_utf8_lossy(&self.pending).into_owned();
                self.pending.clear();
                return text;
            }
        };
        let rest = self.pending.split_off(valid);
        let text = String::from_utf8_lossy(&self.pending).into_owned();
        self.pending = rest;
        text
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_a_split_character_for_the_next_chunk() {
        let mut decoder = Utf8Decoder::default();
        let check = "✓".as_bytes();
        assert_eq!(decoder.push(&[b'o', b'k', b' ', check[0]]), "ok ");
        assert_eq!(decoder.push(&check[1..]), "✓");
    }

    #[test]
    fn replaces_bytes_that_are_never_valid() {
        let mut decoder = Utf8Decoder::default();
        assert_eq!(decoder.push(&[b'a', 0xff, b'b']), "a\u{fffd}b");
        assert_eq!(decoder.push(b"c"), "c");
    }
}
