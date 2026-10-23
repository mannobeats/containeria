use http::Method;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::client::Incus;
use crate::name::{validate_name, validate_snapshot_name};
use crate::{Error, MachineState, Result};

/// A saved state of a machine's disk that it can go back to.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct MachineSnapshot {
    pub name: String,
    pub created_at: String,
}

#[derive(Debug, Deserialize)]
struct RawSnapshot {
    name: String,
    #[serde(default)]
    created_at: String,
}

impl From<RawSnapshot> for MachineSnapshot {
    fn from(raw: RawSnapshot) -> Self {
        Self { name: raw.name, created_at: raw.created_at }
    }
}

fn snapshots_path(machine: &str, snapshot: &str) -> Result<String> {
    validate_name(machine)?;
    validate_snapshot_name(snapshot)?;
    Ok(format!("/1.0/instances/{machine}/snapshots/{snapshot}"))
}

/// A standalone copy of `from` named `to`, without `from`'s snapshots.
fn copy_body(from: &str, to: &str) -> Result<Value> {
    validate_name(from)?;
    validate_name(to)?;
    Ok(json!({
        "name": to,
        "source": { "type": "copy", "source": from, "instance_only": true },
    }))
}

impl Incus {
    /// The machine's snapshots, newest first.
    ///
    /// # Errors
    /// Fails when the machine doesn't exist.
    pub async fn snapshots(&self, machine: &str) -> Result<Vec<MachineSnapshot>> {
        validate_name(machine)?;
        let raw: Vec<RawSnapshot> =
            self.get(&format!("/1.0/instances/{machine}/snapshots?recursion=1")).await?;
        let mut snapshots: Vec<MachineSnapshot> = raw.into_iter().map(Into::into).collect();
        snapshots.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        Ok(snapshots)
    }

    /// Saves the disk as it is now. A running machine keeps running.
    ///
    /// # Errors
    /// Fails on a bad name, a name already taken, or when Incus refuses.
    pub async fn snapshot(&self, machine: &str, snapshot: &str) -> Result<()> {
        snapshots_path(machine, snapshot)?;
        let body = json!({ "name": snapshot, "stateful": false });
        self.run(Method::POST, &format!("/1.0/instances/{machine}/snapshots"), Some(&body)).await
    }

    /// Puts the disk back as it was in the snapshot; everything since is lost. Incus stops a
    /// running machine for the restore and starts it again.
    ///
    /// # Errors
    /// Fails when the snapshot doesn't exist or Incus refuses.
    pub async fn restore(&self, machine: &str, snapshot: &str) -> Result<()> {
        snapshots_path(machine, snapshot)?;
        let body = json!({ "restore": snapshot });
        self.run(Method::PUT, &format!("/1.0/instances/{machine}"), Some(&body)).await
    }

    /// # Errors
    /// Fails when the snapshot doesn't exist or Incus refuses.
    pub async fn delete_snapshot(&self, machine: &str, snapshot: &str) -> Result<()> {
        self.run(Method::DELETE, &snapshots_path(machine, snapshot)?, None).await
    }

    /// Copies a machine to a new, stopped machine named `to`. A running system container is
    /// copied as it is on disk at that moment.
    ///
    /// # Errors
    /// Fails on a bad or taken name, or when Incus can't copy the machine while it runs.
    pub async fn copy(&self, from: &str, to: &str) -> Result<()> {
        let body = copy_body(from, to)?;
        let running = self.machine(from).await?.state != MachineState::Stopped;
        match self.run(Method::POST, "/1.0/instances", Some(&body)).await {
            Err(Error::Incus(reason)) if running => {
                Err(Error::Incus(format!("{reason}. Stop {from} and clone it again.")))
            }
            copied => copied,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_incus_snapshots() {
        let raw = r#"[{"name":"before-upgrade","created_at":"2026-10-17T15:55:32.198972101Z",
            "stateful":false,"size":0,"expires_at":"0001-01-01T00:00:00Z","config":{}}]"#;
        let raw: Vec<RawSnapshot> = serde_json::from_str(raw).unwrap();
        let snapshots: Vec<MachineSnapshot> = raw.into_iter().map(Into::into).collect();
        assert_eq!(snapshots[0].name, "before-upgrade");
        assert_eq!(snapshots[0].created_at, "2026-10-17T15:55:32.198972101Z");
        let sent = serde_json::to_value(&snapshots[0]).unwrap();
        assert_eq!(sent["createdAt"], "2026-10-17T15:55:32.198972101Z");
    }

    #[test]
    fn copies_without_the_snapshots() {
        let body = copy_body("ubuntu", "ubuntu-copy").unwrap();
        assert_eq!(body["name"], "ubuntu-copy");
        assert_eq!(
            body["source"],
            json!({ "type": "copy", "source": "ubuntu", "instance_only": true })
        );
        assert!(copy_body("ubuntu", "Ubuntu Copy").is_err());
    }

    #[test]
    fn builds_snapshot_paths_only_from_valid_names() {
        assert_eq!(
            snapshots_path("dev", "2026-10-17-1530").unwrap(),
            "/1.0/instances/dev/snapshots/2026-10-17-1530"
        );
        assert!(snapshots_path("dev", "../dev").is_err());
    }
}
