//! The agent inside Contena's Linux guest. One binary with three jobs, chosen by how it is
//! started:
//!
//! - as process 1 it is the guest's init (`init`): it mounts the system, starts itself again as
//!   the agent and collects every orphaned process until the agent ends, then powers off;
//! - with `serve` it is the agent (`serve`): it starts Docker and answers the engine on the Mac;
//! - under the name Docker runs its port proxy by, it publishes one port on the Mac and then
//!   becomes Docker's own proxy (`proxy`).

#[cfg(target_os = "linux")]
mod docker;
#[cfg(target_os = "linux")]
mod error;
#[cfg(target_os = "linux")]
mod init;
#[cfg(target_os = "linux")]
mod k3s;
#[cfg(target_os = "linux")]
mod mac;
#[cfg(target_os = "linux")]
mod proxy;
#[cfg(target_os = "linux")]
mod publish;
#[cfg(target_os = "linux")]
mod relay;
#[cfg(target_os = "linux")]
mod serve;
#[cfg(target_os = "linux")]
mod system;
#[cfg(target_os = "linux")]
mod watching;

use std::io::Write;
use std::process::ExitCode;

/// Where programs are looked for. The kernel starts process 1 without a `PATH`; the agent and
/// everything it starts, Docker included, get this one.
#[cfg(target_os = "linux")]
const PATH: &str = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";

/// Writes one line to the guest's console, which the engine keeps as its log.
fn log(message: impl std::fmt::Display) {
    // The console is all there is to report to; if it is gone there is nobody to tell.
    let _ = writeln!(std::io::stderr().lock(), "agent: {message}");
}

#[cfg(target_os = "linux")]
fn main() -> ExitCode {
    let mut arguments = std::env::args();
    let program = arguments.next().unwrap_or_default();
    if program.ends_with(proxy::NAME) {
        return proxy::run(&arguments.collect::<Vec<_>>());
    }
    if std::process::id() == 1 {
        init::run();
    }
    if arguments.next().as_deref() != Some("serve") {
        log("this is the guest's init; it has nothing to do when run by hand");
        return ExitCode::FAILURE;
    }
    match serve::run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            log(format_args!("stopped: {error}"));
            ExitCode::FAILURE
        }
    }
}

#[cfg(not(target_os = "linux"))]
fn main() -> ExitCode {
    log("this program runs only inside Contena's Linux guest");
    ExitCode::FAILURE
}
