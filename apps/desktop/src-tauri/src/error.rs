use serde::Serialize;

pub(crate) type Result<T, E = CommandError> = std::result::Result<T, E>;

/// What the UI can do about a failure: each kind gets its own empty state or action.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ErrorKind {
    EngineMissing,
    EngineStopped,
    /// Kubernetes is off, still starting, or its API server doesn't answer.
    KubernetesUnavailable,
    NotFound,
    /// The user stopped it: dismissed a macOS permission prompt or cancelled a running query.
    Cancelled,
    /// What was asked doesn't fit, such as a missing field or a bad host name; the message says which.
    InvalidInput,
    Engine,
    Internal,
    /// A database said no, or couldn't be reached.
    Database,
    /// A production database is in safe mode; the UI offers to allow writes.
    ReadOnly,
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
            Data::Invalid(_) | Data::Unsupported(_) => ErrorKind::InvalidInput,
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
            containeria_engine::Error::Storage(_) => ErrorKind::InvalidInput,
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
            containeria_docker::Error::Io(_) => ErrorKind::Internal,
        };
        Self::new(kind, error.to_string())
    }
}

impl From<containeria_net::Error> for CommandError {
    fn from(error: containeria_net::Error) -> Self {
        use containeria_net::Error as Net;
        let kind = match error {
            Net::Cancelled => ErrorKind::Cancelled,
            Net::InvalidHost(_) => ErrorKind::InvalidInput,
            Net::UnknownRoute(_) => ErrorKind::NotFound,
            _ => ErrorKind::Internal,
        };
        Self::new(kind, error.to_string())
    }
}

impl From<containeria_machines::Error> for CommandError {
    fn from(error: containeria_machines::Error) -> Self {
        let kind = match error {
            containeria_machines::Error::Unreachable(_) => ErrorKind::EngineStopped,
            containeria_machines::Error::NotFound(_) => ErrorKind::NotFound,
            containeria_machines::Error::Invalid(_) | containeria_machines::Error::Incus(_) => {
                ErrorKind::Engine
            }
            containeria_machines::Error::Protocol(_) => ErrorKind::Internal,
        };
        Self::new(kind, error.to_string())
    }
}

impl From<containeria_kube::Error> for CommandError {
    fn from(error: containeria_kube::Error) -> Self {
        let kind = match error {
            containeria_kube::Error::Unreachable(_) => ErrorKind::KubernetesUnavailable,
            containeria_kube::Error::NotFound(_) => ErrorKind::NotFound,
            containeria_kube::Error::Manifest(_) | containeria_kube::Error::Api(_) => {
                ErrorKind::Engine
            }
        };
        Self::new(kind, error.to_string())
    }
}

impl From<tauri::Error> for CommandError {
    fn from(error: tauri::Error) -> Self {
        Self::new(ErrorKind::Internal, error.to_string())
    }
}
