//! Contena's engine: a small Linux VM that runs Docker, and the process on the Mac that owns
//! it.
//!
//! [`Engine`] is what the app and `cx` hold: it starts the engine process, asks its status and
//! stops it. The process itself is [`run`], in the `contena-engine` binary. While it runs,
//! Docker's socket is at [`Home::docker_socket`]; the VM behind it turns off while nothing runs
//! and back on at the next connection.

mod api;
mod client;
mod config;
mod daemon;
mod error;
mod home;
mod host;
mod storage;

pub use api::{ClusterState, MemoryUse, Phase, Status, Vm};
pub use client::{Changes, Engine, Hold};
pub use config::{EngineConfig, K3S_DEFAULT_VERSION, Kubernetes};
pub use daemon::run;
pub use error::{Error, Result};
pub use home::Home;
pub use host::Host;
pub use storage::{DataLocation, MoveProgress, destination, location, move_data};
