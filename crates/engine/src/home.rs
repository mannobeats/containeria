use std::env;
use std::path::{Path, PathBuf};

use crate::error::{Error, Result};

/// A Colima profile Containeria owns. Docker and Incus can't share one, so machines get their own.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize, specta::Type,
)]
#[serde(rename_all = "camelCase")]
pub enum Profile {
    Containers,
    Machines,
}

impl Profile {
    #[must_use]
    pub const fn name(self) -> &'static str {
        match self {
            Self::Containers => "containeria",
            Self::Machines => "containeria-machines",
        }
    }

    #[must_use]
    pub const fn runtime(self) -> &'static str {
        match self {
            Self::Containers => "docker",
            Self::Machines => "incus",
        }
    }
}

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

    #[must_use]
    pub fn colima(&self) -> PathBuf {
        self.root.join("colima")
    }

    #[must_use]
    pub fn profile_dir(&self, profile: Profile) -> PathBuf {
        self.colima().join(profile.name())
    }

    #[must_use]
    pub fn config_file(&self, profile: Profile) -> PathBuf {
        self.profile_dir(profile).join("colima.yaml")
    }

    #[must_use]
    pub fn docker_socket(&self) -> PathBuf {
        self.profile_dir(Profile::Containers).join("docker.sock")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn profile_paths_follow_colima_layout() {
        let home = Home::at("/Users/ada/.containeria");
        assert_eq!(
            home.docker_socket(),
            PathBuf::from("/Users/ada/.containeria/colima/containeria/docker.sock")
        );
        assert_eq!(
            home.config_file(Profile::Machines),
            PathBuf::from("/Users/ada/.containeria/colima/containeria-machines/colima.yaml")
        );
    }

    #[test]
    fn socket_path_fits_the_macos_limit() {
        let home = Home::at("/Users/a-rather-long-user-name/.containeria");
        assert!(home.docker_socket().as_os_str().len() < 104);
    }
}
