use std::collections::HashMap;
use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::sync::{Arc, Mutex, MutexGuard, OnceLock, PoisonError};
use std::time::{Duration, Instant};

use containeria_engine::{Colima, EngineConfig, Home, Instance, LogLine, Profile};
use containeria_machines::{
    Incus, Machine, MachineAction, MachineState, Shell, ShellInput, client_config, shell_command,
};
use futures::StreamExt;
use serde::Serialize;
use tauri::{AppHandle, Manager};
use tauri_specta::Event;
use tokio::sync::mpsc;

use crate::engine::{EnginePhase, phase_of};
use crate::error::{CommandError, ErrorKind, Result};
use crate::events::MachinesChanged;
use crate::state::AppState;
use crate::streams::Streams;

/// How long the machines VM may sit with nothing running before it stops to free its memory.
const IDLE_STOP: Duration = Duration::from_mins(5);

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
    /// The machines as last seen at rest, shown while the VM is off.
    known: Mutex<Option<Vec<Machine>>>,
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
            known: Mutex::new(None),
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

    /// Stops a running machines VM as the app quits, like `Engine::stop_on_quit`.
    pub(crate) async fn stop_on_quit(&self) -> Result<()> {
        if self.status().await?.phase != EnginePhase::Running {
            return Ok(());
        }
        Ok(self.colima()?.stop(Profile::Machines, |_| {}).await?)
    }

    /// Deletes the machines VM and every machine in it.
    pub(crate) async fn delete(&self, app: &AppHandle) -> Result<()> {
        let colima = self.colima()?;
        self.transition_while(app, EnginePhase::Stopping, colima.delete(Profile::Machines, |_| {}))
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

    /// Every machine. While the VM is off, the ones it had when last seen, all stopped.
    pub(crate) async fn machines(&self) -> Result<Vec<Machine>> {
        let Ok(incus) = self.incus().await else { return Ok(self.known().await) };
        let machines = incus.machines().await?;
        self.remember(&machines).await;
        Ok(machines)
    }

    pub(crate) async fn machine(&self, name: &str) -> Result<Machine> {
        if let Ok(incus) = self.incus().await {
            return Ok(incus.machine(name).await?);
        }
        self.known().await.into_iter().find(|machine| machine.name == name).ok_or_else(|| {
            CommandError::new(ErrorKind::NotFound, format!("There's no machine called {name}."))
        })
    }

    /// Starts, stops or restarts a machine, starting the machines VM first when it's off.
    pub(crate) async fn act(
        &self,
        app: &AppHandle,
        settings: &EngineConfig,
        name: &str,
        action: MachineAction,
    ) -> Result<()> {
        if self.status().await?.phase != EnginePhase::Running {
            if action == MachineAction::Stop {
                return Ok(());
            }
            self.start(app, settings, |_| {}).await?;
        }
        let incus = self.incus().await?;
        // Incus brings back what ran when the VM stopped, so the machine may be up already.
        if action == MachineAction::Start
            && incus.machine(name).await?.state == MachineState::Running
        {
            return Ok(());
        }
        Ok(incus.act(name, action).await?)
    }

    /// Whether the VM runs with no machine up, no Incus operation in flight and no shell open.
    async fn is_idle(&self) -> bool {
        if lock(&self.transition).is_some() || !lock(&self.shells).is_empty() {
            return false;
        }
        let Ok(incus) = self.incus().await else { return false };
        let Ok(machines) = incus.machines().await else { return false };
        machines
            .iter()
            .all(|machine| matches!(machine.state, MachineState::Stopped | MachineState::Error))
            && incus.is_busy().await.is_ok_and(|busy| !busy)
    }

    fn known_file(&self) -> std::path::PathBuf {
        self.home.root().join("machines").join("known.json")
    }

    async fn known(&self) -> Vec<Machine> {
        if let Some(known) = lock(&self.known).clone() {
            return known;
        }
        let known: Vec<Machine> = tokio::fs::read(self.known_file())
            .await
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default();
        *lock(&self.known) = Some(known.clone());
        known
    }

    async fn remember(&self, machines: &[Machine]) {
        let at_rest: Vec<Machine> = machines.iter().cloned().map(at_rest).collect();
        if lock(&self.known).as_ref() == Some(&at_rest) {
            return;
        }
        let Ok(json) = serde_json::to_string(&at_rest) else { return };
        if write(&self.known_file(), &json).await.is_ok() {
            *lock(&self.known) = Some(at_rest);
        }
    }

    /// The command that opens the machine's root shell from a Mac terminal, writing the `incus`
    /// client config it reads.
    pub(crate) async fn shell_command(&self, name: &str) -> Result<String> {
        let incus = self.colima()?.tool("incus").ok_or_else(|| {
            CommandError::new(ErrorKind::EngineMissing, "The incus client isn't installed.")
        })?;
        let config_dir = self.home.root().join("incus");
        write(&config_dir.join("config.yml"), &client_config(&self.home.incus_socket())).await?;
        Ok(shell_command(&incus, &config_dir, name)?)
    }

    /// Opens a Terminal window with the machine's root shell, through a `.command` file so macOS
    /// asks for no Automation permission.
    pub(crate) async fn open_terminal(&self, name: &str) -> Result<()> {
        let command = self.shell_command(name).await?;
        let script = self.home.root().join("terminal").join(format!("{name}.command"));
        write(&script, &format!("#!/bin/sh\nexec {command}\n")).await?;
        tokio::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755))
            .await
            .map_err(|error| file_error(&script, &error))?;
        let opened = tokio::process::Command::new("/usr/bin/open")
            .args(["-a", "Terminal"])
            .arg(&script)
            .kill_on_drop(true)
            .status()
            .await
            .map_err(|error| CommandError::new(ErrorKind::Internal, error.to_string()))?;
        if opened.success() {
            Ok(())
        } else {
            Err(CommandError::new(ErrorKind::Internal, "Terminal didn't open."))
        }
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

/// A machine as it is while the VM is off: stopped, with no address or usage.
fn at_rest(machine: Machine) -> Machine {
    Machine {
        state: MachineState::Stopped,
        ipv4: None,
        memory_bytes: 0,
        cpu_seconds: 0.0,
        processes: 0,
        ..machine
    }
}

/// Stops the machines VM once it has had nothing to do for `IDLE_STOP`; starting a machine brings
/// it back.
pub(crate) async fn stop_when_idle(app: AppHandle) {
    let mut idle_since: Option<Instant> = None;
    let mut tick = tokio::time::interval(Duration::from_secs(30));
    loop {
        tick.tick().await;
        let machines = &app.state::<AppState>().machines;
        idle_since = if machines.is_idle().await {
            idle_since.or_else(|| Some(Instant::now()))
        } else {
            None
        };
        if idle_since.is_some_and(|since| since.elapsed() >= IDLE_STOP) {
            idle_since = None;
            if let Err(error) = machines.stop(&app, |_| {}).await {
                tracing::warn!("the idle machines VM didn't stop: {}", error.message);
            }
        }
    }
}

fn file_error(path: &Path, error: &std::io::Error) -> CommandError {
    CommandError::new(
        ErrorKind::Internal,
        format!("{} couldn't be written: {error}", path.display()),
    )
}

/// Writes a file, making its folder first.
async fn write(path: &Path, contents: &str) -> Result<()> {
    if let Some(folder) = path.parent() {
        tokio::fs::create_dir_all(folder).await.map_err(|error| file_error(folder, &error))?;
    }
    tokio::fs::write(path, contents).await.map_err(|error| file_error(path, &error))
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
    fn a_machine_at_rest_keeps_its_identity_and_drops_live_state() {
        let running = Machine {
            name: "dev".to_owned(),
            distro: "Ubuntu".to_owned(),
            release: "noble".to_owned(),
            kind: containeria_machines::MachineKind::Container,
            state: MachineState::Running,
            ipv4: Some("10.0.0.2".to_owned()),
            memory_bytes: 1024,
            cpu_seconds: 3.5,
            processes: 12,
            cpu_limit: Some("2".to_owned()),
            memory_limit: None,
            home: Some("/Users/me".to_owned()),
            created_at: "2026-10-17T10:00:00Z".to_owned(),
        };
        let rested = at_rest(running.clone());
        assert_eq!(rested.state, MachineState::Stopped);
        assert_eq!((rested.ipv4.as_deref(), rested.memory_bytes, rested.processes), (None, 0, 0));
        assert_eq!(
            (rested.name, rested.cpu_limit, rested.home),
            (running.name, running.cpu_limit, running.home)
        );
    }

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
