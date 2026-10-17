use std::io;

pub type Result<T, E = Error> = std::result::Result<T, E>;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("there's no connection named {0}")]
    UnknownConnection(String),

    #[error("{0} isn't connected")]
    NotConnected(String),

    #[error("{0} is in safe mode: writes are blocked until you allow them")]
    ReadOnly(String),

    #[error("{0}")]
    Unsupported(String),

    #[error("{0}")]
    Invalid(String),

    #[error("the database said: {0}")]
    Database(String),

    #[error("the password couldn't be read from or saved to the Keychain: {0}")]
    Keychain(String),

    #[error("{0}")]
    Docker(#[from] containeria_docker::Error),

    #[error("a saved file couldn't be read: {0}")]
    Json(#[from] serde_json::Error),

    #[error(transparent)]
    Io(#[from] io::Error),
}

impl From<sqlx::Error> for Error {
    fn from(error: sqlx::Error) -> Self {
        match error {
            sqlx::Error::Database(database) => Self::Database(database.message().to_owned()),
            other => Self::Database(other.to_string()),
        }
    }
}

impl From<redis::RedisError> for Error {
    fn from(error: redis::RedisError) -> Self {
        Self::Database(error.to_string())
    }
}

impl From<mongodb::error::Error> for Error {
    fn from(error: mongodb::error::Error) -> Self {
        Self::Database(error.to_string())
    }
}

impl From<clickhouse::error::Error> for Error {
    fn from(error: clickhouse::error::Error) -> Self {
        Self::Database(error.to_string())
    }
}

impl From<csv::Error> for Error {
    fn from(error: csv::Error) -> Self {
        Self::Io(io::Error::other(error))
    }
}
