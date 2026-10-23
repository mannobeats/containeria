use std::collections::HashMap;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use futures::TryStreamExt;
use http::Method;
use http_body_util::{BodyExt, StreamBody};
use hyper::body::Frame;
use serde::Deserialize;
use serde_json::{Map, Value, json};
use tokio::fs::File;
use tokio::io::AsyncWriteExt;
use tokio_util::io::ReaderStream;

use crate::client::Incus;
use crate::name::validate_name;
use crate::{Error, Result};

fn file_error(path: &Path) -> impl FnOnce(std::io::Error) -> Error {
    let path = path.display().to_string();
    move |source| Error::File { path, source }
}

/// A gzip tarball of the machine without its snapshots, which `import` takes back.
fn backup_body(backup: &str) -> Value {
    json!({
        "name": backup,
        "instance_only": true,
        "optimized_storage": false,
        "compression_algorithm": "gzip",
    })
}

#[derive(Debug, Deserialize)]
struct RawConfig {
    #[serde(default)]
    config: HashMap<String, String>,
}

/// Clears the network cards' MAC addresses a backup carries, so an imported copy can run beside
/// its original; Incus makes new ones on the next start.
fn fresh_addresses(config: &HashMap<String, String>) -> Value {
    let cleared: Map<String, Value> = config
        .keys()
        .filter(|key| key.starts_with("volatile.") && key.ends_with(".hwaddr"))
        .map(|key| (key.clone(), Value::from("")))
        .collect();
    json!({ "config": cleared })
}

fn import_headers(name: &str) -> [(&'static str, &str); 2] {
    [("content-type", "application/octet-stream"), ("x-incus-name", name)]
}

impl Incus {
    /// Writes the machine to `destination` as a `.tar.gz` that `import` reads, streaming it so a
    /// large disk never sits in memory. The backup Incus makes for it is deleted afterwards.
    ///
    /// # Errors
    /// Fails when the machine doesn't exist, the backup fails or the file can't be written; a
    /// half-written file is removed.
    pub async fn export(&self, machine: &str, destination: &Path) -> Result<()> {
        validate_name(machine)?;
        let seconds =
            SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |since| since.as_secs());
        let backup = format!("containeria-export-{seconds}");
        let backups = format!("/1.0/instances/{machine}/backups");
        self.run(Method::POST, &backups, Some(&backup_body(&backup))).await?;
        let written = self.save(&format!("{backups}/{backup}/export"), destination).await;
        if written.is_err() {
            let _ = tokio::fs::remove_file(destination).await;
        }
        let deleted = self.run(Method::DELETE, &format!("{backups}/{backup}"), None).await;
        written.and(deleted)
    }

    async fn save(&self, path: &str, destination: &Path) -> Result<()> {
        let mut body = self.download(path).await?;
        let mut file = File::create(destination).await.map_err(file_error(destination))?;
        while let Some(frame) = body.frame().await {
            let frame = frame.map_err(|error| Error::Protocol(error.to_string()))?;
            if let Ok(data) = frame.into_data() {
                file.write_all(&data).await.map_err(file_error(destination))?;
            }
        }
        file.flush().await.map_err(file_error(destination))
    }

    /// Creates a stopped machine named `name` from a `.tar.gz` that `export` wrote, streaming the
    /// file to Incus.
    ///
    /// # Errors
    /// Fails on a bad or taken name, a file that can't be read, or one that isn't an Incus backup.
    pub async fn import(&self, name: &str, source: &Path) -> Result<()> {
        validate_name(name)?;
        let file = File::open(source).await.map_err(file_error(source))?;
        let body = StreamBody::new(ReaderStream::new(file).map_ok(Frame::data));
        self.run_upload("/1.0/instances", body, &import_headers(name)).await?;
        let path = format!("/1.0/instances/{name}");
        let imported: RawConfig = self.get(&path).await?;
        self.patch(&path, &fresh_addresses(&imported.config)).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn asks_for_a_portable_gzip_backup_of_the_machine_alone() {
        let body = backup_body("containeria-export-1");
        assert_eq!(body["instance_only"], true);
        assert_eq!(body["optimized_storage"], false);
        assert_eq!(body["compression_algorithm"], "gzip");
    }

    #[test]
    fn names_the_imported_machine_in_a_header() {
        assert_eq!(
            import_headers("restored"),
            [("content-type", "application/octet-stream"), ("x-incus-name", "restored")]
        );
    }

    #[test]
    fn clears_only_the_mac_addresses_of_an_imported_machine() {
        let config = HashMap::from([
            ("volatile.eth0.hwaddr".to_owned(), "10:66:6a:e3:81:89".to_owned()),
            ("volatile.eth0.host_name".to_owned(), "veth7c8cbf98".to_owned()),
            ("limits.memory".to_owned(), "4GiB".to_owned()),
        ]);
        assert_eq!(fresh_addresses(&config), json!({ "config": { "volatile.eth0.hwaddr": "" } }));
    }

    #[test]
    fn says_which_file_failed() {
        let error = file_error(Path::new("/Users/ada/dev.tar.gz"))(std::io::Error::other("full"));
        assert_eq!(error.to_string(), "/Users/ada/dev.tar.gz couldn't be used: full");
    }
}
