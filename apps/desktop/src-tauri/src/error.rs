use serde::Serialize;

pub(crate) type Result<T, E = CommandError> = std::result::Result<T, E>;

/// What the UI can do about a failure: each kind gets its own empty state or action.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ErrorKind {
    EngineMissing,
    EngineStopped,
    NotFound,
    Engine,
    Internal,
    /// A database said no, or couldn't be reached.
    Database,
    /// A production database is in safe mode; the UI offers to allow writes.
    ReadOnly,
    /// What was asked doesn't fit, such as a missing field; the message says which.
    Invalid,
    /// The user stopped it, such as a running query.
    Cancelled,
}

/// The one error shape every command rejects with.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type, thiserror::Error)]
#[serde(rename_all = "camelCase")]
#[error("{message}")]
pub(crate) struct CommandError {
    pub(crate) kind: ErrorKind,
    pub(crate) message: String,
}

impl CommandError {
    pub(crate) fn new(kind: ErrorKind, message: impl Into<String>) -> Self {
        Self { kind, message: message.into() }
    }

    pub(crate) fn engine_stopped() -> Self {
        Self::new(ErrorKind::EngineStopped, "The engine isn't running.")
    }
}

impl From<containeria_data::Error> for CommandError {
    fn from(error: containeria_data::Error) -> Self {
        use containeria_data::Error as Data;
        let kind = match &error {
            Data::UnknownConnection(_) => ErrorKind::NotFound,
            Data::ReadOnly(_) => ErrorKind::ReadOnly,
            Data::Invalid(_) | Data::Unsupported(_) => ErrorKind::Invalid,
            Data::Docker(containeria_docker::Error::Unreachable(_)) => ErrorKind::EngineStopped,
            Data::NotConnected(_) | Data::Database(_) | Data::Docker(_) => ErrorKind::Database,
            Data::Keychain(_) | Data::Json(_) | Data::Io(_) => ErrorKind::Internal,
        };
        Self::new(kind, error.to_string())
    }
}

impl From<containeria_engine::Error> for CommandError {
    fn from(error: containeria_engine::Error) -> Self {
        let kind = match error {
            containeria_engine::Error::ColimaMissing { .. } => ErrorKind::EngineMissing,
            containeria_engine::Error::Command { .. } => ErrorKind::Engine,
            _ => ErrorKind::Internal,
        };
        Self::new(kind, error.to_string())
    }
}

impl From<containeria_docker::Error> for CommandError {
    fn from(error: containeria_docker::Error) -> Self {
        let kind = match error {
            containeria_docker::Error::Unreachable(_) => ErrorKind::EngineStopped,
            containeria_docker::Error::NotFound(_) => ErrorKind::NotFound,
            containeria_docker::Error::Engine(_) => ErrorKind::Engine,
        };
        Self::new(kind, error.to_string())
    }
}

impl From<tauri::Error> for CommandError {
    fn from(error: tauri::Error) -> Self {
        Self::new(ErrorKind::Internal, error.to_string())
    }
}
