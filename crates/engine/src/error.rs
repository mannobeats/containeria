use std::io;

pub type Result<T, E = Error> = std::result::Result<T, E>;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("colima was not found; looked in {searched}")]
    ColimaMissing { searched: String },

    #[error("the home folder could not be found")]
    NoHomeFolder,

    #[error("`colima {action}` failed: {message}")]
    Command { action: &'static str, message: String },

    #[error("colima printed output Containeria could not read: {0}")]
    Parse(#[from] serde_json::Error),

    #[error("the engine settings could not be written: {0}")]
    Config(#[from] yaml_serde::Error),

    #[error("there's no Docker context named {0}; starting the engine creates Containeria's")]
    NoDockerContext(String),

    #[error("{path} isn't valid JSON, so Containeria left it alone: {source}")]
    DockerConfig { path: String, source: serde_json::Error },

    /// The data can't move there; the message says why, for the user.
    #[error("{0}")]
    Storage(String),

    #[error(transparent)]
    Io(#[from] io::Error),
}
