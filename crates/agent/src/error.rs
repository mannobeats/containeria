use std::io;

#[derive(Debug, thiserror::Error)]
pub(crate) enum Error {
    /// What was being done, then why it failed.
    #[error("{0}: {1}")]
    Io(String, #[source] io::Error),
    #[error("{0}")]
    Failed(String),
}

pub(crate) type Result<T, E = Error> = std::result::Result<T, E>;

/// Names what was being done when a system call failed.
pub(crate) trait Doing<T> {
    fn doing(self, what: impl Into<String>) -> Result<T>;
}

impl<T, E: Into<io::Error>> Doing<T> for std::result::Result<T, E> {
    fn doing(self, what: impl Into<String>) -> Result<T> {
        self.map_err(|error| Error::Io(what.into(), error.into()))
    }
}
