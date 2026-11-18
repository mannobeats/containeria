use std::env;
use std::path::{Path, PathBuf};

use crate::error::{Error, Result};

/// Where Containeria keeps engine state. Short on purpose: Unix socket paths are limited to 104
/// bytes on macOS, which rules out `~/Library/Application Support`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Home {
    root: PathBuf,
}

impl Home {
    /// `$CONTAINERIA_HOME`, or `~/.containeria`.
    ///
    /// # Errors
    /// Fails when neither the variable nor a home folder exists.
    pub fn from_env() -> Result<Self> {
        if let Some(root) = env::var_os("CONTAINERIA_HOME") {
            return Ok(Self::at(root));
        }
        env::home_dir().map(|home| Self::at(home.join(".containeria"))).ok_or(Error::NoHomeFolder)
    }

    pub fn at(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    #[must_use]
    pub fn root(&self) -> &Path {
        &self.root
    }

    /// The engine's settings, read at every start.
    #[must_use]
    pub fn config_file(&self) -> PathBuf {
        self.root.join("engine.json")
    }

    /// Sockets and the lock that keeps the engine to one process.
    #[must_use]
    pub fn run(&self) -> PathBuf {
        self.root.join("run")
    }

    /// Docker's socket, as the `docker` command and the app use it. It exists while the engine is
    /// on, also while its VM sleeps: a connection wakes it.
    #[must_use]
    pub fn docker_socket(&self) -> PathBuf {
        self.run().join("docker.sock")
    }

    /// Docker's socket for watchers: programs that poll Docker in the background, as the app does
    /// for its lists and charts. It answers only while the VM runs, never wakes it and never keeps
    /// it awake, so watching costs nothing when nothing runs.
    #[must_use]
    pub fn docker_watch_socket(&self) -> PathBuf {
        self.run().join("docker-watch.sock")
    }

    /// The way into the guest's network: a connection that starts with one line naming an
    /// address there (see `containeria_proto::Forward`) is then a connection to that address.
    /// Like the watchers' socket it works only while the VM runs and never wakes it.
    #[must_use]
    pub fn inside_socket(&self) -> PathBuf {
        self.run().join("inside.sock")
    }

    /// Where the app and `cx` talk to the engine itself.
    #[must_use]
    pub fn engine_socket(&self) -> PathBuf {
        self.run().join("engine.sock")
    }

    /// The VM's own files: its data disk and its network address. A link when the data was moved
    /// to another drive.
    #[must_use]
    pub fn vm(&self) -> PathBuf {
        self.root.join("vm")
    }

    /// Images, containers and volumes: the one file that grows.
    #[must_use]
    pub fn data_disk(&self) -> PathBuf {
        self.vm().join("data.img")
    }

    #[must_use]
    pub fn logs(&self) -> PathBuf {
        self.root.join("log")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sockets_live_under_run() {
        let home = Home::at("/Users/ada/.containeria");
        assert_eq!(home.docker_socket(), PathBuf::from("/Users/ada/.containeria/run/docker.sock"));
        assert_eq!(home.engine_socket(), PathBuf::from("/Users/ada/.containeria/run/engine.sock"));
    }

    #[test]
    fn socket_paths_fit_the_macos_limit() {
        let home = Home::at("/Users/a-rather-long-user-name-for-a-mac/.containeria");
        assert!(home.docker_socket().as_os_str().len() < 104);
        assert!(home.engine_socket().as_os_str().len() < 104);
    }
}
