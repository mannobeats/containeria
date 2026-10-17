//! Domains for containers on the Mac. A DNS server answers `*.containeria.local` (and the user's own
//! names) with 127.0.0.1, a reverse proxy routes each name to its container, and a local certificate
//! authority makes `https://` work. Nothing outside `~/.containeria/net` changes until the user
//! approves it.

mod ca;
mod dns;
mod error;
mod host;
mod proxy;
mod routes;
mod service;
mod system;

pub use ca::CA_NAME;
pub use error::{Error, Result};
pub use host::{DEFAULT_TLD, container_host};
pub use routes::{ClusterService, CustomRoute, DomainRoute, RouteDown, RouteKind};
pub use service::{DNS_PORT, DomainPorts, Domains, DomainsStatus, running_ports};
pub use system::{ResolverState, privileged};
