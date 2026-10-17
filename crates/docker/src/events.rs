use bollard::models::{EventMessage, EventMessageTypeEnum};
use futures::{Stream, StreamExt};
use serde::Serialize;

use crate::{Docker, Result};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum ObjectKind {
    Container,
    Image,
    Volume,
    Network,
}

/// Something changed in the engine; the UI refetches what it shows of that kind.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct DockerEvent {
    pub kind: ObjectKind,
    pub action: String,
    pub id: String,
}

impl DockerEvent {
    fn from_message(message: EventMessage) -> Option<Self> {
        let kind = match message.typ? {
            EventMessageTypeEnum::CONTAINER => ObjectKind::Container,
            EventMessageTypeEnum::IMAGE => ObjectKind::Image,
            EventMessageTypeEnum::VOLUME => ObjectKind::Volume,
            EventMessageTypeEnum::NETWORK => ObjectKind::Network,
            _ => return None,
        };
        let action = message.action.unwrap_or_default();
        // exec and health probes fire constantly and change nothing the lists show
        if action.starts_with("exec_") || action.starts_with("health_status") || action == "top" {
            return None;
        }
        let id = message.actor.and_then(|actor| actor.id).unwrap_or_default();
        Some(Self { kind, action, id })
    }
}

impl Docker {
    /// Engine events as they happen, without polling.
    pub fn events(&self) -> impl Stream<Item = Result<DockerEvent>> + use<> {
        self.api.events(None).filter_map(|event| async move {
            match event {
                Ok(message) => DockerEvent::from_message(message).map(Ok),
                Err(error) => Some(Err(error.into())),
            }
        })
    }
}

#[cfg(test)]
mod tests {
    use bollard::models::EventActor;

    use super::*;

    fn message(typ: EventMessageTypeEnum, action: &str) -> EventMessage {
        EventMessage {
            typ: Some(typ),
            action: Some(action.to_owned()),
            actor: Some(EventActor { id: Some("abc".into()), attributes: None }),
            ..Default::default()
        }
    }

    #[test]
    fn keeps_lifecycle_events() {
        let event = DockerEvent::from_message(message(EventMessageTypeEnum::CONTAINER, "die"));
        assert_eq!(
            event,
            Some(DockerEvent {
                kind: ObjectKind::Container,
                action: "die".into(),
                id: "abc".into()
            })
        );
    }

    #[test]
    fn drops_noisy_events() {
        for action in ["exec_create: sh", "exec_start: sh", "health_status: healthy", "top"] {
            assert_eq!(
                DockerEvent::from_message(message(EventMessageTypeEnum::CONTAINER, action)),
                None
            );
        }
        assert_eq!(
            DockerEvent::from_message(message(EventMessageTypeEnum::DAEMON, "reload")),
            None
        );
    }
}
