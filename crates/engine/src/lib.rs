//! The engine is Colima, pinned and unchanged, driven through its CLI.
//!
//! Containeria keeps its own Colima home so it never touches a Colima the user installed, and runs
//! two profiles: one for containers and Kubernetes, one for Linux machines.

mod colima;
mod config;
mod docker_context;
mod error;
mod home;
mod host;
mod log_line;
mod storage;

pub use colima::{Colima, Instance, InstanceStatus, KubernetesAction, RuntimeInfo};
pub use config::{EngineConfig, K3S_DEFAULT_VERSION, Kubernetes, VmType};
pub use docker_context::{DockerConfig, ForeignContext};
pub use error::{Error, Result};
pub use home::{Home, Profile};
pub use host::{Host, supports_nested_virtualization};
pub use log_line::{LogLevel, LogLine};
pub use storage::{DataLocation, MoveProgress, destination, disk_size, location, move_data};
