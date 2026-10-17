//! Containeria's view of the Docker Engine API. Wraps `bollard` and turns its wire types into the
//! small, fully populated types the app shows.

mod containers;
mod events;
mod stats;
mod system;
mod transfer;

use std::path::Path;

use bollard::API_DEFAULT_VERSION;

pub use containers::{ContainerAction, ContainerState, ContainerSummary, Port, PortProtocol};
pub use events::{DockerEvent, ObjectKind};
pub use stats::{CpuCounters, StatsSample, Usage};
pub use system::EngineInfo;

pub type Result<T, E = Error> = std::result::Result<T, E>;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("the Docker engine isn't reachable at {0}")]
    Unreachable(String),

    #[error("{0} was not found")]
    NotFound(String),

    #[error("{0}")]
    Engine(String),
}

impl From<bollard::errors::Error> for Error {
    fn from(error: bollard::errors::Error) -> Self {
        use bollard::errors::Error as Bollard;
        match error {
            Bollard::DockerResponseServerError { status_code: 404, message } => {
                Self::NotFound(message)
            }
            Bollard::DockerResponseServerError { message, .. } => Self::Engine(message),
            Bollard::SocketNotFoundError(path) => Self::Unreachable(path),
            other => Self::Engine(other.to_string()),
        }
    }
}

/// A connection to one Docker engine.
#[derive(Debug, Clone)]
pub struct Docker {
    api: bollard::Docker,
}

impl Docker {
    const TIMEOUT_SECONDS: u64 = 120;

    /// Connects to the engine's Unix socket. Doesn't touch the network until the first call.
    ///
    /// # Errors
    /// Fails when the socket file doesn't exist.
    pub fn connect(socket: &Path) -> Result<Self> {
        let path = socket.to_string_lossy();
        let api = bollard::Docker::connect_with_socket(
            &path,
            Self::TIMEOUT_SECONDS,
            API_DEFAULT_VERSION,
        )?;
        Ok(Self { api })
    }

    /// Checks the engine answers.
    ///
    /// # Errors
    /// Fails when the engine doesn't respond.
    pub async fn ping(&self) -> Result<()> {
        self.api.ping().await?;
        Ok(())
    }
}
