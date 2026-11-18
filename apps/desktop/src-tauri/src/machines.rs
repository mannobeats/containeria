//! Linux machines as the app offers them: made and kept by `contena_machines` in the engine,
//! with their terminals and files going through Docker like any container's.

use std::os::unix::fs::{MetadataExt, PermissionsExt};
use std::path::Path;

use contena_machines::{Machines, User};

use crate::engine::Engine;
use crate::error::{CommandError, ErrorKind, Result};

/// The engine's machines. Asking for them wakes the engine's VM, as any use of Docker does.
///
/// # Errors
/// Fails with `EngineStopped` when the engine is off.
pub(crate) async fn machines(engine: &Engine) -> Result<Machines> {
    engine.docker().await?;
    Ok(Machines::connect(&engine.docker_socket())?)
}

/// The container behind a machine, by the name Docker knows it by.
pub(crate) fn container(name: &str) -> Result<String> {
    contena_machines::validate_name(name)?;
    Ok(format!("contena-machine-{name}"))
}

/// The person at the Mac: who a new machine's user is, and whose home folder it can mount.
pub(crate) fn user() -> User {
    let home = std::env::home_dir();
    User {
        name: std::env::var("USER").unwrap_or_default(),
        uid: home
            .as_deref()
            .and_then(|home| std::fs::metadata(home).ok())
            .map_or(501, |home| home.uid()),
        home: home.map(|home| home.to_string_lossy().into_owned()),
    }
}

/// The command that opens the machine's login shell from a Mac terminal.
pub(crate) async fn shell_command(engine: &Engine, name: &str) -> Result<String> {
    let machine = machines(engine).await?.machine(name).await?;
    Ok(engine.docker_cli()?.login_command(&container(name)?, &machine.user))
}

/// Opens a Terminal window with the machine's login shell, through a `.command` file so macOS
/// asks for no Automation permission.
pub(crate) async fn open_terminal(engine: &Engine, name: &str) -> Result<()> {
    let command = shell_command(engine, name).await?;
    let script = engine.home().root().join("terminal").join(format!("{name}.command"));
    write(&script, &format!("#!/bin/sh\nexec {command}\n")).await?;
    tokio::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755))
        .await
        .map_err(|error| file_error(&script, &error))?;
    let opened = tokio::process::Command::new("/usr/bin/open")
        .args(["-a", "Terminal"])
        .arg(&script)
        .kill_on_drop(true)
        .status()
        .await
        .map_err(|error| CommandError::new(ErrorKind::Internal, error.to_string()))?;
    if opened.success() {
        Ok(())
    } else {
        Err(CommandError::new(ErrorKind::Internal, "Terminal didn't open."))
    }
}

async fn write(path: &Path, contents: &str) -> Result<()> {
    if let Some(folder) = path.parent() {
        tokio::fs::create_dir_all(folder).await.map_err(|error| file_error(folder, &error))?;
    }
    tokio::fs::write(path, contents).await.map_err(|error| file_error(path, &error))
}

fn file_error(path: &Path, error: &std::io::Error) -> CommandError {
    CommandError::new(
        ErrorKind::Internal,
        format!("{} couldn't be written: {error}", path.display()),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_machines_container_carries_its_name() {
        assert_eq!(container("dev").unwrap(), "contena-machine-dev");
    }

    #[test]
    fn a_name_that_is_not_a_machines_names_no_container() {
        assert!(container("../etc").is_err());
        assert!(container("").is_err());
    }
}
