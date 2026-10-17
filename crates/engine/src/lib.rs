//! The engine is Colima, pinned and unchanged, driven through its CLI.
//!
//! Containeria keeps its own Colima home so it never touches a Colima the user installed, and runs
//! two profiles: one for containers and Kubernetes, one for Linux machines.

mod colima;
mod config;
mod error;
mod home;
mod host;
mod log_line;

pub use colima::{Colima, Instance, InstanceStatus, RuntimeInfo};
pub use config::{EngineConfig, K3S_DEFAULT_VERSION, Kubernetes, VmType};
pub use error::{Error, Result};
pub use home::{Home, Profile};
pub use host::{Host, supports_nested_virtualization};
pub use log_line::{LogLevel, LogLine};
