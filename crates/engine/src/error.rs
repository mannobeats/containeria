use std::io;

pub type Result<T, E = Error> = std::result::Result<T, E>;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("The home folder could not be found.")]
    NoHomeFolder,

    /// A part of the engine that ships with the app isn't where it should be.
    #[error("{what} wasn't found; looked in {searched}.")]
    Missing { what: &'static str, searched: String },

    #[error("The engine isn't running.")]
    Stopped,

    /// The engine said why something failed, in a sentence for the user.
    #[error("{0}")]
    Engine(String),

    /// The data can't move there; the message says why, for the user.
    #[error("{0}")]
    Storage(String),

    #[error("The engine's settings could not be read: {0}")]
    Settings(#[from] serde_json::Error),

    #[error(transparent)]
    Io(#[from] io::Error),
}

impl From<contena_proto::rpc::Error> for Error {
    fn from(error: contena_proto::rpc::Error) -> Self {
        match error {
            contena_proto::rpc::Error::Closed => Self::Stopped,
            other => Self::Engine(other.to_string()),
        }
    }
}
