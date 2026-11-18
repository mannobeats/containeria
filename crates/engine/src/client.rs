//! The engine as the app and `cx` use it: a process they start, ask and stop over its socket.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::{Duration, Instant};

use contena_proto::rpc::{self, Caller, Incoming};
use tokio::net::UnixStream;
use tokio::process::Command;
use tokio::sync::mpsc;

use crate::api::{ClientCall, EngineNote, Status};
use crate::error::{Error, Result};
use crate::home::Home;

const PROGRAM: &str = "contena-engine";
const START_PATIENCE: Duration = Duration::from_secs(10);

#[derive(Debug, Clone)]
pub struct Engine {
    home: Home,
    program: PathBuf,
}

/// An open conversation with the engine. Its calls end when it is dropped.
struct Connection {
    caller: Caller,
    notes: mpsc::Receiver<Incoming<EngineNote>>,
}

/// Keeps the engine's VM awake until dropped.
#[derive(Debug)]
pub struct Hold {
    _connection: Caller,
    notes: mpsc::Receiver<Incoming<EngineNote>>,
}

impl Hold {
    /// Waits until the engine is gone, and this hold with it: whoever wants the VM awake takes a
    /// new one from the engine's next run.
    pub async fn lost(&mut self) {
        while self.notes.recv().await.is_some() {}
    }
}

/// The engine's status each time its phase changes.
#[derive(Debug)]
pub struct Changes {
    _connection: Caller,
    notes: mpsc::Receiver<Incoming<EngineNote>>,
}

impl Changes {
    /// The next status, or `None` once the engine has stopped.
    pub async fn next(&mut self) -> Option<Status> {
        let (EngineNote::Changed(status), answer) = self.notes.recv().await?.split();
        answer.send(Ok::<_, String>(())).await;
        Some(status)
    }
}

impl Engine {
    /// The engine for `home`. Its program is `$CONTENA_ENGINE`, else `bundled` (the app's
    /// copy), else the one next to this program, else the one in the app bundle this program is
    /// part of, which is where `cx` finds it.
    #[must_use]
    pub fn locate(home: Home, bundled: Option<&Path>) -> Self {
        let own = std::env::current_exe().and_then(std::fs::canonicalize).unwrap_or_default();
        let folder = own.parent().unwrap_or_else(|| Path::new(""));
        let beside = folder.join(PROGRAM);
        let in_bundle = folder.join("../../engine").join(PROGRAM);
        let in_bundle = std::fs::canonicalize(&in_bundle).unwrap_or(in_bundle);
        let program = std::env::var_os("CONTENA_ENGINE")
            .map(PathBuf::from)
            .or_else(|| bundled.map(Path::to_path_buf))
            .unwrap_or_else(|| if in_bundle.is_file() { in_bundle } else { beside });
        Self { home, program }
    }

    #[must_use]
    pub const fn home(&self) -> &Home {
        &self.home
    }

    /// What the engine is doing. An engine that isn't running is `Stopped`, not an error.
    pub async fn status(&self) -> Status {
        match self.connect().await {
            Ok(connection) => connection
                .caller
                .call(&ClientCall::Status)
                .await
                .unwrap_or_else(|_| Status::stopped()),
            Err(_) => Status::stopped(),
        }
    }

    /// Starts the engine, or wakes its VM, and returns once Docker answers.
    ///
    /// # Errors
    /// Fails with the engine's own sentence when the VM doesn't start, and with `Missing` when the
    /// engine isn't installed where it should be.
    pub async fn start(&self) -> Result<()> {
        let connection = match self.connect().await {
            Ok(connection) => connection,
            Err(_) => self.launch().await?,
        };
        Ok(connection.caller.call(&ClientCall::Start).await?)
    }

    /// Stops the engine: its containers, its VM and the process. Returns once the process is
    /// gone, so a start right after begins a new one. Does nothing when the engine is stopped.
    ///
    /// # Errors
    /// Fails when the engine goes away without answering.
    pub async fn stop(&self) -> Result<()> {
        let Ok(mut connection) = self.connect().await else { return Ok(()) };
        connection.caller.call::<_, ()>(&ClientCall::Stop).await?;
        // The engine closes its connections as it exits.
        let gone = async { while connection.notes.recv().await.is_some() {} };
        let _ = tokio::time::timeout(START_PATIENCE, gone).await;
        Ok(())
    }

    /// Starts the Kubernetes cluster with the saved settings and makes it `kubectl`'s current
    /// one. Returns once its API answers; the first time, that includes fetching k3s.
    ///
    /// # Errors
    /// Fails with the engine's sentence when the cluster doesn't start.
    pub async fn start_kubernetes(&self) -> Result<()> {
        Ok(self.connect().await?.caller.call(&ClientCall::KubernetesStart).await?)
    }

    /// Stops the cluster and takes it out of the kubeconfig. Its objects are kept.
    ///
    /// # Errors
    /// Fails with `Stopped` when the engine isn't running.
    pub async fn stop_kubernetes(&self) -> Result<()> {
        Ok(self.connect().await?.caller.call(&ClientCall::KubernetesStop).await?)
    }

    /// Deletes everything in the cluster and starts a fresh one.
    ///
    /// # Errors
    /// Fails with the engine's sentence when the fresh cluster doesn't start.
    pub async fn reset_kubernetes(&self) -> Result<()> {
        Ok(self.connect().await?.caller.call(&ClientCall::KubernetesReset).await?)
    }

    /// Deletes the engine's data disk: every image, container and volume. Settings stay, so the
    /// next start makes a fresh engine the same size.
    ///
    /// # Errors
    /// Fails when the engine can't be stopped first or the disk can't be removed.
    pub async fn reset(&self) -> Result<()> {
        self.stop().await?;
        match std::fs::remove_file(self.home.data_disk()) {
            Err(error) if error.kind() != std::io::ErrorKind::NotFound => Err(error.into()),
            _ => Ok(()),
        }
    }

    /// Whether the engine was ever started: its data disk exists.
    #[must_use]
    pub fn created(&self) -> bool {
        self.home.data_disk().exists()
    }

    /// Whether the engine's program is where it should be.
    #[must_use]
    pub fn installed(&self) -> bool {
        self.program.is_file()
    }

    /// Wakes the VM and keeps it awake while something watches it, as an open window does.
    ///
    /// # Errors
    /// Fails with `Stopped` when the engine isn't running.
    pub async fn hold(&self) -> Result<Hold> {
        let Connection { caller, notes } = self.connect().await?;
        caller.call::<_, ()>(&ClientCall::Hold).await?;
        Ok(Hold { _connection: caller, notes })
    }

    /// Follows the engine's phase.
    ///
    /// # Errors
    /// Fails with `Stopped` when the engine isn't running.
    pub async fn changes(&self) -> Result<Changes> {
        let Connection { caller, notes } = self.connect().await?;
        caller.call::<_, ()>(&ClientCall::Subscribe).await?;
        Ok(Changes { _connection: caller, notes })
    }

    async fn connect(&self) -> Result<Connection> {
        let stream =
            UnixStream::connect(self.home.engine_socket()).await.map_err(|_| Error::Stopped)?;
        let (reader, writer) = stream.into_split();
        let (caller, notes) = rpc::open(reader, writer);
        Ok(Connection { caller, notes })
    }

    /// Starts the engine process, detached from this one, and connects to it.
    async fn launch(&self) -> Result<Connection> {
        if !self.program.is_file() {
            return Err(Error::Missing {
                what: "The engine",
                searched: self.program.display().to_string(),
            });
        }
        std::fs::create_dir_all(self.home.logs())?;
        let log = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(self.home.logs().join("engine.log"))?;
        let mut engine = Command::new(&self.program)
            .env("CONTENA_HOME", self.home.root())
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(log)
            .process_group(0)
            .spawn()?;
        let started = Instant::now();
        loop {
            if let Ok(connection) = self.connect().await {
                return Ok(connection);
            }
            if let Some(status) = engine.try_wait()? {
                return Err(Error::Engine(format!(
                    "The engine ended as it started ({status}). Its log is in {}.",
                    self.home.logs().display()
                )));
            }
            if started.elapsed() > START_PATIENCE {
                return Err(Error::Engine(
                    "The engine didn't answer within 10 seconds.".to_owned(),
                ));
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    }
}
