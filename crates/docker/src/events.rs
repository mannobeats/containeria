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
    /// The container, image or network name Docker reports, or the id when it reports none.
    pub name: String,
    /// How a container's process ended; only `die` carries it.
    pub exit_code: Option<i32>,
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
        // exec and health probes fire constantly and change nothing the lists show; a failing
        // health check is kept for its notification
        let probe = action.starts_with("health_status") && action != "health_status: unhealthy";
        if action.starts_with("exec_") || probe || action == "top" {
            return None;
        }
        let actor = message.actor.unwrap_or_default();
        let id = actor.id.unwrap_or_default();
        let mut attributes = actor.attributes.unwrap_or_default();
        let exit_code = attributes.get("exitCode").and_then(|code| code.parse().ok());
        let name = attributes.remove("name").unwrap_or_else(|| id.clone());
        Some(Self { kind, action, id, name, exit_code })
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
    fn keeps_lifecycle_events_with_their_name_and_exit_code() {
        let mut die = message(EventMessageTypeEnum::CONTAINER, "die");
        die.actor = Some(EventActor {
            id: Some("abc".into()),
            attributes: Some(
                [("name".into(), "web".into()), ("exitCode".into(), "1".into())].into(),
            ),
        });
        assert_eq!(
            DockerEvent::from_message(die),
            Some(DockerEvent {
                kind: ObjectKind::Container,
                action: "die".into(),
                id: "abc".into(),
                name: "web".into(),
                exit_code: Some(1),
            })
        );
    }

    #[test]
    fn names_an_object_by_its_id_when_docker_reports_no_name() {
        let event =
            DockerEvent::from_message(message(EventMessageTypeEnum::VOLUME, "create")).unwrap();
        assert_eq!((event.name.as_str(), event.exit_code), ("abc", None));
    }

    #[test]
    fn keeps_a_failing_health_check() {
        let event = message(EventMessageTypeEnum::CONTAINER, "health_status: unhealthy");
        assert!(DockerEvent::from_message(event).is_some());
    }

    #[test]
    fn drops_noisy_events() {
        for action in [
            "exec_create: sh",
            "exec_start: sh",
            "health_status: healthy",
            "health_status: starting",
            "top",
        ] {
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
