use std::fmt::Write as _;

use bytes::Bytes;
use futures::{StreamExt, stream};
use http::{HeaderMap, Method, header};
use serde::Serialize;

use crate::client::{Incus, Reply};
use crate::name::validate_name;
use crate::{Error, Result};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum MachineFileKind {
    File,
    Directory,
    Symlink,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct MachineFile {
    pub name: String,
    pub path: String,
    pub kind: MachineFileKind,
    #[specta(type = specta_typescript::Number)]
    pub size_bytes: u64,
}

const TYPE_HEADER: &str = "x-incus-type";

fn kind_of(headers: &HeaderMap) -> MachineFileKind {
    match headers.get(TYPE_HEADER).and_then(|value| value.to_str().ok()) {
        Some("directory") => MachineFileKind::Directory,
        Some("symlink") => MachineFileKind::Symlink,
        _ => MachineFileKind::File,
    }
}

/// Percent-encodes a path for the `path` query parameter, keeping slashes readable.
fn encode(path: &str) -> String {
    path.bytes().fold(String::with_capacity(path.len()), |mut encoded, byte| {
        if byte.is_ascii_alphanumeric() || b"-_.~/".contains(&byte) {
            encoded.push(char::from(byte));
        } else {
            let _ = write!(encoded, "%{byte:02X}");
        }
        encoded
    })
}

fn join(directory: &str, name: &str) -> String {
    format!("{}/{name}", directory.trim_end_matches('/'))
}

fn sort(entries: &mut [MachineFile]) {
    entries.sort_by(|a, b| {
        (a.kind != MachineFileKind::Directory, a.name.to_lowercase())
            .cmp(&(b.kind != MachineFileKind::Directory, b.name.to_lowercase()))
    });
}

impl Incus {
    async fn file(&self, method: Method, machine: &str, path: &str) -> Result<Reply> {
        validate_name(machine)?;
        if !path.starts_with('/') {
            return Err(Error::Invalid(format!("{path} isn't an absolute path.")));
        }
        let url = format!("/1.0/instances/{machine}/files?path={}", encode(path));
        let reply = self.send(method, &url, Bytes::new(), &[]).await?;
        if !reply.status.is_success() {
            return Err(Error::NotFound(path.to_owned()));
        }
        Ok(reply)
    }

    /// The folder's entries, folders first.
    ///
    /// # Errors
    /// Fails when the path isn't a folder in a running machine.
    pub async fn list_files(&self, machine: &str, path: &str) -> Result<Vec<MachineFile>> {
        let reply = self.file(Method::GET, machine, path).await?;
        if kind_of(&reply.headers) != MachineFileKind::Directory {
            return Err(Error::Invalid(format!("{path} isn't a folder.")));
        }
        let names: Vec<String> = serde_json::from_slice::<serde_json::Value>(&reply.body)?
            .get("metadata")
            .map(|metadata| serde_json::from_value(metadata.clone()))
            .transpose()?
            .unwrap_or_default();
        let mut entries: Vec<MachineFile> = stream::iter(names)
            .map(|name| async move {
                let path = join(path, &name);
                let head = self.file(Method::HEAD, machine, &path).await.ok()?;
                let size_bytes = head
                    .headers
                    .get(header::CONTENT_LENGTH)
                    .and_then(|value| value.to_str().ok()?.parse().ok())
                    .unwrap_or(0);
                Some(MachineFile { kind: kind_of(&head.headers), name, path, size_bytes })
            })
            .buffer_unordered(8)
            .filter_map(|entry| async move { entry })
            .collect()
            .await;
        sort(&mut entries);
        Ok(entries)
    }

    /// # Errors
    /// Fails when the path isn't a file in a running machine.
    pub async fn read_file(&self, machine: &str, path: &str) -> Result<Bytes> {
        let reply = self.file(Method::GET, machine, path).await?;
        if kind_of(&reply.headers) == MachineFileKind::Directory {
            return Err(Error::Invalid(format!("{path} is a folder.")));
        }
        Ok(reply.body)
    }

    /// Creates or replaces a file, owned by root.
    ///
    /// # Errors
    /// Fails when the folder doesn't exist or the machine isn't running.
    pub async fn write_file(&self, machine: &str, path: &str, contents: Bytes) -> Result<()> {
        validate_name(machine)?;
        let url = format!("/1.0/instances/{machine}/files?path={}", encode(path));
        let headers = [
            ("x-incus-type", "file"),
            ("x-incus-write", "overwrite"),
            ("content-type", "application/octet-stream"),
        ];
        let reply = self.send(Method::POST, &url, contents, &headers).await?;
        if reply.status.is_success() {
            Ok(())
        } else {
            Err(Error::Incus(format!("{path} couldn't be written")))
        }
    }
}

#[cfg(test)]
mod tests {
    use http::HeaderValue;

    use super::*;

    #[test]
    fn encodes_the_path_query() {
        assert_eq!(encode("/root/My Notes/a&b.txt"), "/root/My%20Notes/a%26b.txt");
        assert_eq!(encode("/etc/os-release"), "/etc/os-release");
    }

    #[test]
    fn joins_paths_without_doubling_slashes() {
        assert_eq!(join("/", "etc"), "/etc");
        assert_eq!(join("/root/", "notes"), "/root/notes");
    }

    #[test]
    fn reads_the_entry_kind_from_incus_headers() {
        let mut headers = HeaderMap::new();
        assert_eq!(kind_of(&headers), MachineFileKind::File);
        headers.insert(TYPE_HEADER, HeaderValue::from_static("directory"));
        assert_eq!(kind_of(&headers), MachineFileKind::Directory);
    }

    #[test]
    fn sorts_folders_first_then_by_name() {
        let entry = |name: &str, kind| MachineFile {
            name: name.into(),
            path: name.into(),
            kind,
            size_bytes: 0,
        };
        let mut entries = vec![
            entry("b.txt", MachineFileKind::File),
            entry("Zeta", MachineFileKind::Directory),
            entry("a.txt", MachineFileKind::File),
        ];
        sort(&mut entries);
        let names: Vec<_> = entries.iter().map(|entry| entry.name.as_str()).collect();
        assert_eq!(names, ["Zeta", "a.txt", "b.txt"]);
    }
}
