use std::collections::HashMap;
use std::time::{Duration, Instant};

use containeria_docker::{DockerEvent, ObjectKind};
use tauri::{AppHandle, Manager};
use tauri_plugin_notification::NotificationExt;
use tauri_specta::Event;

use crate::events::Navigate;
use crate::metrics::Ledger;
use crate::preferences::NotifyOn;
use crate::state::AppState;
use crate::tray;

/// Something in the engine worth telling a person who isn't looking at Containeria.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Alert {
    Crashed { id: String, name: String, exit_code: i32 },
    Unhealthy { id: String, name: String },
    MemoryLow { used_bytes: u64, total_bytes: u64 },
}

impl Alert {
    const fn setting(&self) -> NotifyOn {
        match self {
            Self::Crashed { .. } => NotifyOn::Crash,
            Self::Unhealthy { .. } => NotifyOn::Unhealthy,
            Self::MemoryLow { .. } => NotifyOn::LowMemory,
        }
    }

    fn title(&self) -> String {
        match self {
            Self::Crashed { name, .. } => format!("{name} stopped unexpectedly"),
            Self::Unhealthy { name, .. } => format!("{name} is unhealthy"),
            Self::MemoryLow { .. } => "The engine is running low on memory".to_owned(),
        }
    }

    fn body(&self) -> String {
        match self {
            Self::Crashed { exit_code, .. } => format!("It exited with code {exit_code}."),
            Self::Unhealthy { .. } => "Its health check is failing.".to_owned(),
            Self::MemoryLow { used_bytes, total_bytes } => format!(
                "Containers use {} of {}. Stop some, or give the engine more memory in Settings.",
                tray::format_memory(*used_bytes),
                tray::format_memory(*total_bytes)
            ),
        }
    }

    /// The view a click on the notification opens.
    fn path(&self) -> String {
        match self {
            Self::Crashed { id, .. } | Self::Unhealthy { id, .. } => format!("/containers/{id}"),
            Self::MemoryLow { .. } => "/activity".to_owned(),
        }
    }
}

/// Turns Docker events and memory samples into alerts, telling a crash from a container someone
/// stopped, and repeating an alert about one thing at most every ten minutes.
#[derive(Debug, Default)]
pub(crate) struct Alerts {
    /// Containers sent a signal by `docker stop`, `kill`, `rm -f` or Compose, and when.
    signalled: HashMap<String, Instant>,
    last_sent: HashMap<String, Instant>,
}

impl Alerts {
    /// Longer than Docker's default ten seconds between the stop signal and `SIGKILL`.
    const STOP_GRACE: Duration = Duration::from_secs(30);
    const REPEAT_AFTER: Duration = Duration::from_mins(10);
    /// `SIGTERM`: the process was asked to end and did.
    const TERMINATED: i32 = 143;

    pub(crate) fn on_event(&mut self, event: &DockerEvent, now: Instant) -> Option<Alert> {
        if event.kind != ObjectKind::Container {
            return None;
        }
        match event.action.as_str() {
            "kill" => {
                self.signalled.retain(|_, at| now.duration_since(*at) < Self::STOP_GRACE);
                self.signalled.insert(event.id.clone(), now);
                None
            }
            "die" => {
                let signalled = self
                    .signalled
                    .remove(&event.id)
                    .is_some_and(|at| now.duration_since(at) < Self::STOP_GRACE);
                let exit_code =
                    event.exit_code.filter(|code| ![0, Self::TERMINATED].contains(code));
                match exit_code {
                    Some(exit_code) if !signalled => self.first_in_a_while(
                        format!("crash:{}", event.id),
                        now,
                        Alert::Crashed {
                            id: event.id.clone(),
                            name: event.name.clone(),
                            exit_code,
                        },
                    ),
                    _ => None,
                }
            }
            "health_status: unhealthy" => self.first_in_a_while(
                format!("health:{}", event.id),
                now,
                Alert::Unhealthy { id: event.id.clone(), name: event.name.clone() },
            ),
            _ => None,
        }
    }

    pub(crate) fn on_sample(&mut self, ledger: &Ledger, now: Instant) -> Option<Alert> {
        let Ledger { used_bytes, total_bytes, .. } = *ledger;
        if total_bytes == 0 || u128::from(used_bytes) * 10 <= u128::from(total_bytes) * 9 {
            return None;
        }
        self.first_in_a_while(
            "memory".to_owned(),
            now,
            Alert::MemoryLow { used_bytes, total_bytes },
        )
    }

    fn first_in_a_while(&mut self, key: String, now: Instant, alert: Alert) -> Option<Alert> {
        let recent =
            self.last_sent.get(&key).is_some_and(|at| now.duration_since(*at) < Self::REPEAT_AFTER);
        if recent {
            return None;
        }
        self.last_sent.insert(key, now);
        Some(alert)
    }
}

/// Shows `alert` in Notification Center when its switch in Settings is on.
pub(crate) fn send(app: &AppHandle, alert: &Alert) {
    if !app.state::<AppState>().preferences.get().notify_on.contains(&alert.setting()) {
        return;
    }
    let shown = app
        .notification()
        .builder()
        .title(alert.title())
        .body(alert.body())
        .extra("path", alert.path())
        .show();
    if let Err(error) = shown {
        tracing::warn!("couldn't show a notification: {error}");
    }
}

/// A click on a notification brings the window back, at the view the notification names.
pub(crate) fn open_on_click(app: &AppHandle) {
    let handle = app.clone();
    let _ = app.notification().on_action(move |performed| {
        if performed.action_id() != "tap" {
            return;
        }
        tray::show_main(&handle);
        let path = performed
            .notification()
            .and_then(|notification| notification.extra().get("path"))
            .and_then(serde_json::Value::as_str);
        if let Some(path) = path {
            let _ = Navigate(path.to_owned()).emit(&handle);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn event(action: &str, exit_code: Option<i32>) -> DockerEvent {
        DockerEvent {
            kind: ObjectKind::Container,
            action: action.to_owned(),
            id: "abc".to_owned(),
            name: "web".to_owned(),
            exit_code,
        }
    }

    fn crashed(exit_code: i32) -> Alert {
        Alert::Crashed { id: "abc".into(), name: "web".into(), exit_code }
    }

    fn ledger(used_bytes: u64, total_bytes: u64) -> Ledger {
        Ledger { total_bytes, used_bytes, segments: Vec::new() }
    }

    #[test]
    fn a_container_that_exits_with_an_error_on_its_own_crashed() {
        let mut alerts = Alerts::default();
        assert_eq!(alerts.on_event(&event("die", Some(1)), Instant::now()), Some(crashed(1)));
    }

    #[test]
    fn an_out_of_memory_kill_nobody_asked_for_is_a_crash() {
        let mut alerts = Alerts::default();
        assert_eq!(alerts.on_event(&event("die", Some(137)), Instant::now()), Some(crashed(137)));
    }

    #[test]
    fn a_clean_exit_or_sigterm_is_no_crash() {
        let mut alerts = Alerts::default();
        let now = Instant::now();
        assert_eq!(alerts.on_event(&event("die", Some(0)), now), None);
        assert_eq!(alerts.on_event(&event("die", Some(143)), now), None);
        assert_eq!(alerts.on_event(&event("die", None), now), None);
    }

    #[test]
    fn a_container_stopped_or_killed_on_request_did_not_crash() {
        let mut alerts = Alerts::default();
        let now = Instant::now();
        alerts.on_event(&event("kill", None), now);
        let died = now + Duration::from_secs(10);
        assert_eq!(alerts.on_event(&event("die", Some(137)), died), None);
        assert_eq!(alerts.on_event(&event("stop", None), died), None);
    }

    #[test]
    fn a_crash_long_after_a_signal_still_counts() {
        let mut alerts = Alerts::default();
        let now = Instant::now();
        alerts.on_event(&event("kill", None), now);
        let later = now + Alerts::STOP_GRACE;
        assert_eq!(alerts.on_event(&event("die", Some(2)), later), Some(crashed(2)));
    }

    #[test]
    fn a_signal_covers_only_the_next_exit() {
        let mut alerts = Alerts::default();
        let now = Instant::now();
        alerts.on_event(&event("kill", None), now);
        alerts.on_event(&event("die", Some(137)), now);
        alerts.on_event(&event("start", None), now);
        let soon = now + Duration::from_secs(5);
        assert_eq!(alerts.on_event(&event("die", Some(1)), soon), Some(crashed(1)));
    }

    #[test]
    fn a_crash_looping_container_alerts_once_per_ten_minutes() {
        let mut alerts = Alerts::default();
        let now = Instant::now();
        assert!(alerts.on_event(&event("die", Some(1)), now).is_some());
        assert_eq!(alerts.on_event(&event("die", Some(1)), now + Duration::from_mins(1)), None);
        assert!(alerts.on_event(&event("die", Some(1)), now + Alerts::REPEAT_AFTER).is_some());
    }

    #[test]
    fn a_failing_health_check_alerts() {
        let mut alerts = Alerts::default();
        assert_eq!(
            alerts.on_event(&event("health_status: unhealthy", None), Instant::now()),
            Some(Alert::Unhealthy { id: "abc".into(), name: "web".into() })
        );
    }

    #[test]
    fn low_memory_alerts_above_ninety_percent_at_most_every_ten_minutes() {
        let mut alerts = Alerts::default();
        let now = Instant::now();
        assert_eq!(alerts.on_sample(&ledger(90, 100), now), None);
        assert_eq!(alerts.on_sample(&ledger(50, 0), now), None);
        assert_eq!(
            alerts.on_sample(&ledger(91, 100), now),
            Some(Alert::MemoryLow { used_bytes: 91, total_bytes: 100 })
        );
        assert_eq!(alerts.on_sample(&ledger(99, 100), now + Duration::from_mins(9)), None);
        assert!(alerts.on_sample(&ledger(95, 100), now + Alerts::REPEAT_AFTER).is_some());
    }

    #[test]
    fn a_click_opens_the_container_or_activity() {
        assert_eq!(crashed(1).path(), "/containers/abc");
        assert_eq!(Alert::MemoryLow { used_bytes: 1, total_bytes: 1 }.path(), "/activity");
    }
}
