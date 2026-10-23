use std::io::{Cursor, Read};
use std::path::{Path, PathBuf};

use bollard::body_full;
use bollard::container::LogOutput;
use bollard::exec::{CreateExecOptions, StartExecResults};
use bollard::query_parameters::{
    DownloadFromContainerOptionsBuilder, UploadToContainerOptionsBuilder,
};
use bytes::Bytes;
use futures::{StreamExt, TryStreamExt};
use serde::Serialize;
use tokio::io::AsyncWriteExt;

use crate::{Docker, Error, Result};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum FileKind {
    Directory,
    File,
    Symlink,
    Other,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub name: String,
    pub kind: FileKind,
    #[specta(type = specta_typescript::Number)]
    pub size: u64,
    /// Seconds since 1970.
    #[specta(type = specta_typescript::Number)]
    pub modified: u64,
    /// `drwxr-xr-x`, as `ls -l` shows it.
    pub permissions: String,
}

/// Lists one folder with `stat`, so only that folder's entries cross the socket. Works with
/// busybox and GNU coreutils alike.
const LIST: &str = "cd -- \"$1\" || exit 2
for f in .[!.]* ..?* *; do
  if [ -e \"$f\" ] || [ -L \"$f\" ]; then stat -c '%F\t%s\t%Y\t%A\t%n' -- \"$f\"; fi
done";

fn kind_from_stat(kind: &str) -> FileKind {
    match kind {
        "directory" => FileKind::Directory,
        "symbolic link" => FileKind::Symlink,
        "regular file" | "regular empty file" => FileKind::File,
        _ => FileKind::Other,
    }
}

fn parse_stat(output: &str) -> Vec<FileEntry> {
    output
        .lines()
        .filter_map(|line| {
            let mut fields = line.splitn(5, '\t');
            let kind = kind_from_stat(fields.next()?);
            let size = fields.next()?.parse().ok()?;
            let modified = fields.next()?.parse().ok()?;
            let permissions = fields.next()?.to_owned();
            let name = fields.next()?.to_owned();
            Some(FileEntry { name, kind, size, modified, permissions })
        })
        .collect()
}

fn permissions(kind: FileKind, mode: u32) -> String {
    let prefix = match kind {
        FileKind::Directory => 'd',
        FileKind::Symlink => 'l',
        FileKind::File | FileKind::Other => '-',
    };
    let bits = (0..9).rev().map(|bit| {
        let set = mode & (1 << bit) != 0;
        match (set, bit % 3) {
            (false, _) => '-',
            (true, 2) => 'r',
            (true, 1) => 'w',
            (true, _) => 'x',
        }
    });
    std::iter::once(prefix).chain(bits).collect()
}

/// The direct children of the folder a `docker cp`-style tar holds. The tar's first component is
/// the folder itself.
fn parse_tar(tar: &[u8]) -> Result<Vec<FileEntry>> {
    let mut archive = tar::Archive::new(Cursor::new(tar));
    let mut entries = Vec::new();
    for entry in archive.entries()? {
        let entry = entry?;
        let path = entry.path()?.into_owned();
        let mut parts = path.components().skip(1);
        let (Some(name), None) = (parts.next(), parts.next()) else { continue };
        let header = entry.header();
        let kind = match header.entry_type() {
            tar::EntryType::Directory => FileKind::Directory,
            tar::EntryType::Symlink => FileKind::Symlink,
            tar::EntryType::Regular => FileKind::File,
            _ => FileKind::Other,
        };
        entries.push(FileEntry {
            name: name.as_os_str().to_string_lossy().into_owned(),
            kind,
            size: header.size().unwrap_or(0),
            modified: header.mtime().unwrap_or(0),
            permissions: permissions(kind, header.mode().unwrap_or(0)),
        });
    }
    Ok(entries)
}

fn sort(mut entries: Vec<FileEntry>) -> Vec<FileEntry> {
    entries.sort_by(|a, b| {
        (a.kind != FileKind::Directory, a.name.to_lowercase())
            .cmp(&(b.kind != FileKind::Directory, b.name.to_lowercase()))
    });
    entries
}

impl Docker {
    /// The entries of one folder, folders first. Uses `stat` in a running container and falls
    /// back to reading the folder as a tar for stopped ones and images without a shell.
    ///
    /// # Errors
    /// Fails when the folder doesn't exist.
    pub async fn list_files(&self, id: &str, path: &str) -> Result<Vec<FileEntry>> {
        if let Ok(output) = self.run_quiet(id, &["/bin/sh", "-c", LIST, "sh", path]).await {
            return Ok(sort(parse_stat(&output)));
        }
        let tar = self.archive(id, path).await?;
        Ok(sort(parse_tar(&tar)?))
    }

    /// Saves a file to `destination` on the Mac. A folder is saved as a `.tar`.
    ///
    /// # Errors
    /// Fails when the path doesn't exist or the destination can't be written.
    pub async fn download(&self, id: &str, path: &str, destination: &Path) -> Result<()> {
        let tar = self.archive(id, path).await?;
        let contents = single_file(&tar)?.unwrap_or_else(|| tar.to_vec());
        Ok(tokio::fs::write(destination, contents).await?)
    }

    /// Copies files and folders from the Mac into `directory` in the container.
    ///
    /// # Errors
    /// Fails when a source can't be read or the container refuses the upload.
    pub async fn upload(&self, id: &str, directory: &str, sources: Vec<PathBuf>) -> Result<()> {
        // ponytail: builds the whole tar in memory; stream it if people upload gigabytes.
        let tar = tokio::task::spawn_blocking(move || tar_of(&sources))
            .await
            .map_err(|error| Error::Engine(error.to_string()))??;
        let options = UploadToContainerOptionsBuilder::new().path(directory).build();
        self.api.upload_to_container(id, Some(options), body_full(Bytes::from(tar))).await?;
        Ok(())
    }

    /// Writes the container's whole filesystem to `destination` as a tar.
    ///
    /// # Errors
    /// Fails when the container is gone or the file can't be written.
    pub async fn export(&self, id: &str, destination: &Path) -> Result<()> {
        let mut file = tokio::fs::File::create(destination).await?;
        let mut chunks = std::pin::pin!(self.api.export_container(id));
        while let Some(chunk) = chunks.next().await {
            file.write_all(&chunk?).await?;
        }
        Ok(file.flush().await?)
    }

    /// Runs a command without a TTY and returns its standard output, failing on a non-zero exit.
    pub(crate) async fn run_quiet(&self, id: &str, cmd: &[&str]) -> Result<String> {
        let exec = self
            .api
            .create_exec(
                id,
                CreateExecOptions {
                    attach_stdout: Some(true),
                    attach_stderr: Some(true),
                    cmd: Some(cmd.to_vec()),
                    ..CreateExecOptions::default()
                },
            )
            .await?;
        let StartExecResults::Attached { output, .. } = self.api.start_exec(&exec.id, None).await?
        else {
            return Err(Error::Engine("the command started detached".to_owned()));
        };
        let chunks: Vec<Bytes> = output
            .try_filter_map(|chunk| async move {
                Ok(match chunk {
                    LogOutput::StdOut { message } | LogOutput::Console { message } => Some(message),
                    _ => None,
                })
            })
            .try_collect()
            .await?;
        let stdout = chunks.concat();
        let code = self.api.inspect_exec(&exec.id).await?.exit_code.unwrap_or(0);
        if code != 0 {
            return Err(Error::Engine(format!("exited with code {code}")));
        }
        Ok(String::from_utf8_lossy(&stdout).into_owned())
    }

    // ponytail: buffers the whole tar; fine for folders people browse, heavy for `/usr` on a
    // stopped container. Stream and stop after the folder's own entries if that shows up.
    async fn archive(&self, id: &str, path: &str) -> Result<Bytes> {
        let options = DownloadFromContainerOptionsBuilder::new().path(path).build();
        let chunks: Vec<Bytes> =
            self.api.download_from_container(id, Some(options)).try_collect().await?;
        Ok(chunks.concat().into())
    }
}

/// The contents when the tar holds exactly one regular file.
fn single_file(tar: &[u8]) -> Result<Option<Vec<u8>>> {
    let mut archive = tar::Archive::new(Cursor::new(tar));
    let mut entries = archive.entries()?;
    let Some(first) = entries.next() else { return Ok(None) };
    let mut first = first?;
    if first.header().entry_type() != tar::EntryType::Regular {
        return Ok(None);
    }
    let mut contents = Vec::new();
    first.read_to_end(&mut contents)?;
    Ok(if entries.next().is_none() { Some(contents) } else { None })
}

fn tar_of(sources: &[PathBuf]) -> Result<Vec<u8>> {
    let mut builder = tar::Builder::new(Vec::new());
    for source in sources {
        let name = source
            .file_name()
            .ok_or_else(|| Error::Engine(format!("{} has no name", source.display())))?;
        if source.is_dir() {
            builder.append_dir_all(name, source)?;
        } else {
            builder.append_path_with_name(source, name)?;
        }
    }
    Ok(builder.into_inner()?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_stat_lines_and_skips_garbage() {
        let entries = parse_stat(
            "directory\t4096\t1760000000\tdrwxr-xr-x\tetc\nregular file\t12\t1760000001\t-rw-r--r--\tmy file.txt\nnonsense\n",
        );
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[1].name, "my file.txt");
        assert_eq!(entries[1].kind, FileKind::File);
        assert_eq!(entries[1].size, 12);
    }

    #[test]
    fn writes_permissions_like_ls() {
        assert_eq!(permissions(FileKind::Directory, 0o755), "drwxr-xr-x");
        assert_eq!(permissions(FileKind::File, 0o640), "-rw-r-----");
    }

    #[test]
    fn lists_only_direct_children_of_a_tarred_folder_and_sorts_folders_first() {
        let dir = tempfile::tempdir().unwrap();
        let app = dir.path().join("app");
        std::fs::create_dir_all(app.join("src")).unwrap();
        std::fs::write(app.join("src/main.rs"), "fn main() {}").unwrap();
        std::fs::write(app.join("README.md"), "hi").unwrap();
        let tar = tar_of(&[app]).unwrap();
        let entries = sort(parse_tar(&tar).unwrap());
        let names: Vec<_> = entries.iter().map(|entry| (entry.name.as_str(), entry.kind)).collect();
        assert_eq!(names, [("src", FileKind::Directory), ("README.md", FileKind::File)]);
    }

    #[test]
    fn unwraps_a_single_file_but_keeps_a_folder_as_tar() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("notes.txt");
        std::fs::write(&file, "hello").unwrap();
        assert_eq!(single_file(&tar_of(&[file]).unwrap()).unwrap(), Some(b"hello".to_vec()));
        assert_eq!(single_file(&tar_of(&[dir.path().to_path_buf()]).unwrap()).unwrap(), None);
    }
}
