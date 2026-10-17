//! Linux machines: Incus system containers and VMs running in Containeria's machines profile,
//! reached through the Incus REST API that Colima forwards to a Unix socket on the Mac.

mod catalogue;
mod client;
mod exec;
mod files;
mod machine;
mod name;

pub use catalogue::{DISTROS, Distro, Release};
pub use client::Incus;
pub use exec::{Shell, ShellInput};
pub use files::{MachineFile, MachineFileKind};
pub use machine::{CreateMachine, Machine, MachineAction, MachineKind, MachineState};
pub use name::validate_name;

pub type Result<T, E = Error> = std::result::Result<T, E>;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("Linux machines aren't running; the Incus socket at {0} doesn't answer")]
    Unreachable(String),

    #[error("{0} was not found")]
    NotFound(String),

    #[error("{0}")]
    Invalid(String),

    #[error("Incus: {0}")]
    Incus(String),

    #[error("Incus sent a reply Containeria couldn't read: {0}")]
    Protocol(String),
}

impl From<serde_json::Error> for Error {
    fn from(error: serde_json::Error) -> Self {
        Self::Protocol(error.to_string())
    }
}
