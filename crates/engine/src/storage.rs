//! Where the engine keeps its virtual disks, and moving them somewhere else.
//!
//! Lima keeps every VM disk under `LIMA_HOME`, which Colima sets to `<COLIMA_HOME>/_lima`. Moving
//! the data moves that folder and leaves a symbolic link in its place, so every path Colima and
//! Lima wrote down keeps working. Lima resolves the link, which puts its Unix sockets on the new
//! drive: the new path has to stay short enough for them.

use std::fs::{self, File};
use std::io::{self, Read, Seek, SeekFrom, Write};
use std::os::unix::fs::{MetadataExt, symlink};
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::error::{Error, Result};
use crate::home::{Home, Profile};

/// The folder made inside the one the user picks.
const FOLDER_NAME: &str = "Containeria";

/// macOS limits a Unix socket path to 104 bytes. Lima puts `ssh.sock` and `ha.sock` inside each
/// instance folder; this leaves room for the longest instance name and a socket file name.
const MAX_SOCKET_PATH: usize = 103;
const SOCKET_FILE_ROOM: usize = 12;

/// Formats that hold symbolic links, Unix sockets and sparse disk images.
const SUPPORTED_FORMATS: [&str; 2] = ["apfs", "hfs"];

const COPY_CHUNK: usize = 4 * 1024 * 1024;

/// Where the engine's disks are.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct DataLocation {
    pub path: String,
    pub is_default: bool,
    /// False when the data lives on a drive that isn't connected.
    pub available: bool,
    /// Space the disks really take, not the size they can grow to.
    #[specta(type = specta_typescript::Number)]
    pub size_bytes: u64,
}

/// How far a move is, in bytes of disk data.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct MoveProgress {
    #[specta(type = specta_typescript::Number)]
    pub copied_bytes: u64,
    #[specta(type = specta_typescript::Number)]
    pub total_bytes: u64,
}

impl Home {
    /// `LIMA_HOME` as Colima sets it: the VM disks, or a link to where they were moved.
    #[must_use]
    pub fn lima(&self) -> PathBuf {
        self.colima().join("_lima")
    }
}

/// Where the data is now.
#[must_use]
pub fn location(home: &Home) -> DataLocation {
    let link = home.lima();
    let is_default = !link.is_symlink();
    let target = if is_default { link.clone() } else { fs::read_link(&link).unwrap_or(link) };
    let available = target.is_dir() || is_default;
    let size_bytes = if available { allocated_size(&target) } else { 0 };
    DataLocation { path: target.to_string_lossy().into_owned(), is_default, available, size_bytes }
}

/// The space one profile's VM disks take on the Mac: Lima's instance folder, which holds the boot
/// disk, and the profile's data disk in `_disks`, where Docker's or Incus's data lives. Holes count
/// as nothing, so this is what the Mac really gave up, not the size the disks can grow to.
#[must_use]
pub fn disk_size(home: &Home, profile: Profile) -> u64 {
    // Colima names a profile's Lima instance, and its data disk, `colima-<profile>`.
    let name = format!("colima-{}", profile.name());
    let lima = home.lima();
    allocated_size(&lima.join(&name)) + allocated_size(&lima.join("_disks").join(&name))
}

/// The folder the data would move to inside `folder`, after checking it can hold it. `None` is
/// the default location.
///
/// # Errors
/// Fails with a sentence for the user when the folder can't take the data.
pub fn destination(home: &Home, folder: Option<&Path>) -> Result<PathBuf> {
    let Some(folder) = folder else {
        let current = fs::canonicalize(home.lima()).unwrap_or_else(|_| home.lima());
        check_space(&home.colima(), &current)?;
        return Ok(home.lima());
    };
    if !folder.is_dir() {
        return Err(Error::Storage(format!("{} isn't a folder.", folder.display())));
    }
    let target = folder.join(FOLDER_NAME);
    let longest = target.as_os_str().len() + 2 + Profile::Machines.name().len() + 6;
    if longest + SOCKET_FILE_ROOM > MAX_SOCKET_PATH {
        return Err(Error::Storage(format!(
            "{} is too deep for the engine's sockets. Pick a folder nearer the top of the drive.",
            folder.display()
        )));
    }
    if target.exists() && fs::read_dir(&target)?.next().is_some() {
        return Err(Error::Storage(format!("{} already has files in it.", target.display())));
    }
    let current = fs::canonicalize(home.lima()).unwrap_or_else(|_| home.lima());
    let folder_real = fs::canonicalize(folder)?;
    if folder_real.starts_with(&current) {
        return Err(Error::Storage("The new location can't be inside the data itself.".to_owned()));
    }
    let format = file_system(folder)?;
    if !SUPPORTED_FORMATS.contains(&format.as_str()) {
        return Err(Error::Storage(format!(
            "{} is formatted as {format}, which can't hold the engine's disks. Use an APFS or Mac OS Extended drive.",
            folder.display()
        )));
    }
    check_space(folder, &current)?;
    Ok(target)
}

/// Refuses a folder on a drive without room for the data, unless the data is already on it.
fn check_space(folder: &Path, data: &Path) -> Result<()> {
    if same_device(data, folder)? {
        return Ok(());
    }
    let free = free_space(folder)?;
    let needed = allocated_size(data);
    if free < needed {
        return Err(Error::Storage(format!(
            "{} has {} free; the data needs {}.",
            folder.display(),
            gigabytes(free),
            gigabytes(needed)
        )));
    }
    Ok(())
}

/// Moves the engine's disks into `folder`, or back to the default with `None`. Both VMs must be
/// stopped. The data is copied before anything is removed, so a failure leaves it where it was.
///
/// # Errors
/// Fails when the destination can't take the data or a copy fails.
pub fn move_data(
    home: &Home,
    folder: Option<&Path>,
    mut on_progress: impl FnMut(MoveProgress),
) -> Result<()> {
    let link = home.lima();
    let source = fs::canonicalize(&link)?;
    let picked = folder.map(|folder| folder.join(FOLDER_NAME));
    if picked
        .as_ref()
        .is_some_and(|picked| fs::canonicalize(picked).is_ok_and(|real| real == source))
    {
        return Ok(());
    }
    let target = destination(home, folder)?;
    let already_there = if target == link {
        !link.is_symlink()
    } else {
        fs::canonicalize(&target).is_ok_and(|real| real == source)
    };
    if already_there {
        return Ok(());
    }
    let partial = sibling(&target, ".moving");
    if partial.exists() {
        fs::remove_dir_all(&partial)?;
    }
    let copied = !same_device(&source, target.parent().unwrap_or(&target))?;
    if copied {
        let total_bytes = allocated_size(&source);
        let mut copied_bytes = 0;
        let result = copy_tree(&source, &partial, &mut |bytes| {
            copied_bytes = (copied_bytes + bytes).min(total_bytes);
            on_progress(MoveProgress { copied_bytes, total_bytes });
        });
        if let Err(error) = result {
            let _ = fs::remove_dir_all(&partial);
            return Err(error.into());
        }
    } else {
        fs::rename(&source, &partial)?;
    }
    let leftover = place(&link, &partial, &target)?;
    if copied {
        // The copy is in place and linked; only now does the original go.
        fs::remove_dir_all(leftover.as_deref().unwrap_or(&source))?;
    }
    rewrite_links(&target, &source, &link)?;
    Ok(())
}

/// Puts the moved data at `target` and points `link` at it, each step a single rename. Returns
/// the default folder's old copy when the data was copied out of it, which is moved aside here.
fn place(link: &Path, partial: &Path, target: &Path) -> io::Result<Option<PathBuf>> {
    if target == link {
        if link.is_symlink() {
            fs::remove_file(link)?;
        }
        fs::rename(partial, target)?;
        return Ok(None);
    }
    if target.exists() {
        fs::remove_dir(target)?;
    }
    fs::rename(partial, target)?;
    let new_link = sibling(link, ".link");
    if new_link.is_symlink() {
        fs::remove_file(&new_link)?;
    }
    symlink(target, &new_link)?;
    if link.is_symlink() || !link.exists() {
        fs::rename(&new_link, link)?;
        return Ok(None);
    }
    let aside = sibling(link, ".old");
    fs::rename(link, &aside)?;
    fs::rename(&new_link, link)?;
    Ok(Some(aside))
}

/// Lima records which VM uses a disk as an absolute link. Links into the old place now point
/// through `link`, which follows the data wherever it goes.
fn rewrite_links(root: &Path, old_root: &Path, link: &Path) -> io::Result<()> {
    for entry in fs::read_dir(root)? {
        let path = entry?.path();
        let metadata = fs::symlink_metadata(&path)?;
        if metadata.is_dir() {
            rewrite_links(&path, old_root, link)?;
        } else if metadata.is_symlink() {
            let pointed = fs::read_link(&path)?;
            if let Ok(rest) = pointed.strip_prefix(old_root) {
                fs::remove_file(&path)?;
                symlink(link.join(rest), &path)?;
            }
        }
    }
    Ok(())
}

fn copy_tree(from: &Path, to: &Path, on_bytes: &mut impl FnMut(u64)) -> io::Result<()> {
    fs::create_dir_all(to)?;
    fs::set_permissions(to, fs::metadata(from)?.permissions())?;
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        let (source, target) = (entry.path(), to.join(entry.file_name()));
        let kind = entry.file_type()?;
        if kind.is_dir() {
            copy_tree(&source, &target, on_bytes)?;
        } else if kind.is_symlink() {
            symlink(fs::read_link(&source)?, &target)?;
        } else if kind.is_file() {
            copy_sparse(&source, &target, on_bytes)?;
        }
        // Sockets and pipes belong to a running VM; a stopped one has nothing to keep in them.
    }
    Ok(())
}

/// Copies only the parts of a file that hold data. VM disks are mostly holes: a 100 GB disk may
/// use 2 GB, and a plain copy would write all 100.
fn copy_sparse(from: &Path, to: &Path, on_bytes: &mut impl FnMut(u64)) -> io::Result<()> {
    let mut source = File::open(from)?;
    let mut target = File::create(to)?;
    let length = source.metadata()?.len();
    let mut buffer = vec![0; COPY_CHUNK];
    let mut offset = 0;
    while offset < length {
        let Some(start) = next_data(&source, offset)? else { break };
        let end = rustix::fs::seek(&source, rustix::fs::SeekFrom::Hole(start))?.min(length);
        source.seek(SeekFrom::Start(start))?;
        target.seek(SeekFrom::Start(start))?;
        let mut left = end - start;
        while left > 0 {
            let chunk = usize::try_from(left).unwrap_or(COPY_CHUNK).min(COPY_CHUNK);
            source.read_exact(&mut buffer[..chunk])?;
            // Zeros the source kept as data stay a hole in the copy.
            if buffer[..chunk].iter().all(|byte| *byte == 0) {
                target.seek(SeekFrom::Current(i64::try_from(chunk).unwrap_or(i64::MAX)))?;
            } else {
                target.write_all(&buffer[..chunk])?;
            }
            left -= chunk as u64;
            on_bytes(chunk as u64);
        }
        offset = end;
    }
    target.set_len(length)?;
    target.sync_all()?;
    fs::set_permissions(to, source.metadata()?.permissions())
}

/// The start of the next run of data at or after `offset`, or `None` when only a hole is left.
fn next_data(file: &File, offset: u64) -> io::Result<Option<u64>> {
    match rustix::fs::seek(file, rustix::fs::SeekFrom::Data(offset)) {
        Ok(start) => Ok(Some(start)),
        Err(rustix::io::Errno::NXIO) => Ok(None),
        Err(error) => Err(error.into()),
    }
}

/// The space a folder's files take on disk, counting holes as nothing.
fn allocated_size(path: &Path) -> u64 {
    let Ok(metadata) = fs::symlink_metadata(path) else { return 0 };
    if !metadata.is_dir() {
        return metadata.blocks() * 512;
    }
    fs::read_dir(path)
        .into_iter()
        .flatten()
        .flatten()
        .map(|entry| allocated_size(&entry.path()))
        .sum()
}

fn same_device(a: &Path, b: &Path) -> io::Result<bool> {
    Ok(fs::metadata(a)?.dev() == fs::metadata(b)?.dev())
}

fn file_system(path: &Path) -> io::Result<String> {
    let stat = rustix::fs::statfs(path)?;
    let name: Vec<u8> = stat
        .f_fstypename
        .iter()
        .take_while(|byte| **byte != 0)
        .map(|byte| byte.to_ne_bytes()[0])
        .collect();
    Ok(String::from_utf8_lossy(&name).into_owned())
}

fn free_space(path: &Path) -> io::Result<u64> {
    let stat = rustix::fs::statvfs(path)?;
    Ok(stat.f_bavail * stat.f_frsize)
}

fn sibling(path: &Path, suffix: &str) -> PathBuf {
    let mut name = path.file_name().unwrap_or_default().to_os_string();
    name.push(suffix);
    path.with_file_name(name)
}

fn gigabytes(bytes: u64) -> String {
    let tenths = bytes / 100_000_000;
    format!("{}.{} GB", tenths / 10, tenths % 10)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Under `/tmp`: macOS's per-user temp folder is too deep for the socket check.
    fn short_tempdir() -> tempfile::TempDir {
        tempfile::Builder::new().tempdir_in("/tmp").unwrap()
    }

    fn home_with_data() -> (tempfile::TempDir, Home) {
        let root = short_tempdir();
        let home = Home::at(root.path().join("home"));
        let disks = home.lima().join("_disks/colima-containeria");
        fs::create_dir_all(&disks).unwrap();
        let instance = home.lima().join("colima-containeria");
        fs::create_dir_all(&instance).unwrap();
        let mut disk = File::create(instance.join("disk")).unwrap();
        disk.seek(SeekFrom::Start(64 * 1024 * 1024)).unwrap();
        disk.write_all(b"data after a hole").unwrap();
        disk.set_len(128 * 1024 * 1024).unwrap();
        symlink(&instance, disks.join("in_use_by")).unwrap();
        (root, home)
    }

    #[test]
    fn moves_the_disks_and_leaves_a_link() {
        let (root, home) = home_with_data();
        let drive = root.path().join("drive");
        fs::create_dir(&drive).unwrap();
        move_data(&home, Some(&drive), |_| {}).unwrap();
        let moved = drive.join(FOLDER_NAME);
        assert_eq!(fs::read_link(home.lima()).unwrap(), moved);
        let disk = home.lima().join("colima-containeria/disk");
        assert_eq!(fs::metadata(&disk).unwrap().len(), 128 * 1024 * 1024);
        let location = location(&home);
        assert!(!location.is_default);
        assert!(location.available);
        assert_eq!(location.path, moved.to_string_lossy());
    }

    #[test]
    fn moves_back_to_the_default() {
        let (root, home) = home_with_data();
        let drive = root.path().join("drive");
        fs::create_dir(&drive).unwrap();
        move_data(&home, Some(&drive), |_| {}).unwrap();
        move_data(&home, None, |_| {}).unwrap();
        assert!(!home.lima().is_symlink());
        assert!(home.lima().join("colima-containeria/disk").is_file());
        assert!(!drive.join(FOLDER_NAME).exists());
        assert!(location(&home).is_default);
    }

    #[test]
    fn copies_only_the_data_of_a_sparse_disk() {
        let root = short_tempdir();
        let (from, to) = (root.path().join("from"), root.path().join("to"));
        let mut file = File::create(&from).unwrap();
        file.write_all(&vec![0; 8 * 1024 * 1024]).unwrap();
        file.seek(SeekFrom::Start(256 * 1024 * 1024)).unwrap();
        file.write_all(b"tail").unwrap();
        let mut copied = 0;
        copy_sparse(&from, &to, &mut |bytes| copied += bytes).unwrap();
        assert_eq!(fs::read(&to).unwrap().len(), 256 * 1024 * 1024 + 4);
        assert!(copied < 64 * 1024 * 1024, "copied {copied} bytes of holes");
        assert!(fs::read(&to).unwrap().ends_with(b"tail"));
        // The 8 MB of written zeros at the start became a hole too.
        assert!(fs::metadata(&to).unwrap().blocks() * 512 < 4 * 1024 * 1024);
    }

    #[test]
    fn points_disk_links_through_the_stable_path() {
        let (root, home) = home_with_data();
        let drive = root.path().join("drive");
        fs::create_dir(&drive).unwrap();
        move_data(&home, Some(&drive), |_| {}).unwrap();
        let in_use_by = drive.join(FOLDER_NAME).join("_disks/colima-containeria/in_use_by");
        assert!(fs::read_link(&in_use_by).unwrap().starts_with(home.lima()));
        assert!(fs::metadata(&in_use_by).unwrap().is_dir());
    }

    #[test]
    fn says_sizes_in_gigabytes() {
        assert_eq!(gigabytes(7_412_000_000), "7.4 GB");
        assert_eq!(gigabytes(0), "0.0 GB");
    }

    #[test]
    fn refuses_a_folder_too_deep_for_the_sockets() {
        let (root, home) = home_with_data();
        let deep = root.path().join("a".repeat(80));
        fs::create_dir(&deep).unwrap();
        let error = destination(&home, Some(&deep)).unwrap_err();
        assert!(error.to_string().contains("too deep"));
    }

    #[test]
    fn refuses_a_folder_that_already_has_data() {
        let (root, home) = home_with_data();
        let drive = root.path().join("drive");
        fs::create_dir_all(drive.join(FOLDER_NAME)).unwrap();
        File::create(drive.join(FOLDER_NAME).join("other")).unwrap();
        assert!(destination(&home, Some(&drive)).is_err());
    }
}
