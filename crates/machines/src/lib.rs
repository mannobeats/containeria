//! Linux machines: a distribution that keeps running, with its own init, your user and your Mac's
//! home folder inside. Each is a container in Containeria's engine, made from the distribution's
//! own image, so machines share the engine's one VM with everything else.

mod archive;
mod catalogue;
mod machine;
mod name;
mod provision;
mod snapshot;

use std::path::Path;

pub use catalogue::{DISTROS, Distro, Release};
pub use machine::{CreateMachine, Machine, MachineAction, MachineState, User};
pub use name::validate_name;
pub use snapshot::MachineSnapshot;

pub type Result<T, E = Error> = std::result::Result<T, E>;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("The engine isn't running, so Linux machines aren't either.")]
    Unreachable,

    #[error("{0} was not found")]
    NotFound(String),

    #[error("{0}")]
    Invalid(String),

    #[error("{0}")]
    Engine(String),

    #[error("{path} couldn't be used: {source}")]
    File { path: String, source: std::io::Error },
}

impl From<bollard::errors::Error> for Error {
    fn from(error: bollard::errors::Error) -> Self {
        use bollard::errors::Error as Docker;
        match error {
            Docker::DockerResponseServerError { status_code: 404, message } => {
                Self::NotFound(message)
            }
            Docker::DockerResponseServerError { message, .. } => Self::Engine(message),
            Docker::IOError { .. }
            | Docker::HyperResponseError { .. }
            | Docker::RequestTimeoutError => Self::Unreachable,
            other => Self::Engine(other.to_string()),
        }
    }
}

/// The machines of one engine.
#[derive(Debug, Clone)]
pub struct Machines {
    api: bollard::Docker,
}

impl Machines {
    /// Setting up a distribution installs packages, which a slow mirror makes slow.
    const TIMEOUT_SECONDS: u64 = 1800;

    /// Connects to the engine's Docker socket. Doesn't touch it until the first call.
    ///
    /// # Errors
    /// Fails when the socket file doesn't exist.
    pub fn connect(socket: &Path) -> Result<Self> {
        let api = bollard::Docker::connect_with_socket(
            &socket.to_string_lossy(),
            Self::TIMEOUT_SECONDS,
            bollard::API_DEFAULT_VERSION,
        )
        .map_err(|_| Error::Unreachable)?;
        Ok(Self { api })
    }
}
