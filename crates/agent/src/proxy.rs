//! Docker's port proxy, as Docker starts it for each published port. It first has the engine
//! listen for the port on the Mac, so a port the Mac can't give fails the container's start with
//! the reason, and then becomes Docker's own proxy, which serves the port inside the guest.

use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::UnixStream;
use std::os::unix::process::CommandExt;
use std::process::{Command, ExitCode};

use contena_agent::ports;
use rustix::io::{FdFlags, fcntl_setfd};

/// The file name Docker runs the agent by for this job.
pub(crate) const NAME: &str = "contena-port-proxy";
pub(crate) const SOCKET: &str = "/run/contena/ports.sock";
const DOCKERS_PROXY: &str = "/usr/local/bin/docker-proxy";

pub(crate) fn run(arguments: &[String]) -> ExitCode {
    let reason = match publish(arguments) {
        // `exec` only returns when it fails. The connection to the agent stays open in Docker's
        // proxy, which is how the agent learns the port is gone when that process ends.
        Ok(_agent) => Command::new(DOCKERS_PROXY).args(arguments).exec().to_string(),
        Err(reason) => reason,
    };
    // Docker reads the outcome from descriptor 3: `0` once the proxy runs, `1` and why if not.
    let _ = fs::write("/proc/self/fd/3", format!("1\n{reason}"));
    ExitCode::FAILURE
}

fn publish(arguments: &[String]) -> Result<UnixStream, String> {
    let port = ports::parse(arguments)?;
    let failed =
        |error: std::io::Error| format!("The engine could not be asked for the port: {error}");
    let mut agent = UnixStream::connect(SOCKET).map_err(failed)?;
    let mut request = serde_json::to_vec(&port).map_err(|error| error.to_string())?;
    request.push(b'\n');
    agent.write_all(&request).map_err(failed)?;
    let mut answer = String::new();
    BufReader::new(&agent).read_line(&mut answer).map_err(failed)?;
    serde_json::from_str::<Result<(), String>>(&answer).map_err(|error| error.to_string())??;
    fcntl_setfd(&agent, FdFlags::empty()).map_err(|error| failed(error.into()))?;
    Ok(agent)
}
