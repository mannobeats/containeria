//! Changes to the Mac's files, reported to the guest.
//!
//! A file edited on the Mac changes inside a container that has its folder mounted, but Linux
//! there raises no event for it: no system call in the guest made the change. Programs that
//! reload when a file changes wait for exactly that event. So the engine has the folders running
//! containers have mounted watched, as the agent names them, and tells the agent what changed;
//! the guest's kernel then raises the events (see `guest/patches`).
//!
//! A change a container makes itself comes back the same way and is raised a second time.
//! Watchers already see more than one event for one act, and take it in their stride.

use std::collections::HashMap;
use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, SystemTime};

use containeria_proto::rpc::Caller;
use containeria_proto::{Change, Changed, EngineCall};
use tokio::sync::mpsc;
use tokio::task::JoinHandle;

use super::vmm::{FileEvent, Vmm};

/// The flags macOS reports file events with, as Apple numbers them.
mod flag {
    pub(super) const MUST_SCAN_SUBDIRS: u32 = 0x1;
    pub(super) const CREATED: u32 = 0x100;
    pub(super) const REMOVED: u32 = 0x200;
    pub(super) const INODE_META: u32 = 0x400;
    pub(super) const RENAMED: u32 = 0x800;
    pub(super) const MODIFIED: u32 = 0x1000;
    pub(super) const OWNER: u32 = 0x4000;
    pub(super) const XATTR: u32 = 0x8000;
    pub(super) const IS_DIR: u32 = 0x20000;
}

/// A file made no longer ago than this is taken to be new.
const NEW: Duration = Duration::from_secs(2);
/// How many paths the engine remembers the files of, before it forgets them all and starts over.
const REMEMBERED: usize = 100_000;

/// What was at each path when it was last reported. The Mac goes on saying "created", "renamed"
/// and "modified" of a file for as long as it remembers the file at all, so what an event means
/// is what differs from last time.
type Seen = HashMap<PathBuf, Sight>;

/// A file as one look at it shows it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Sight {
    /// The number its filesystem knows the file by: another number is another file.
    file: u64,
    size: u64,
    /// When its contents last changed, in nanoseconds.
    written: i128,
    /// Its permissions and owner.
    access: (u32, u32, u32),
}

impl Sight {
    fn of(found: &std::fs::Metadata) -> Self {
        Self {
            file: found.ino(),
            size: found.size(),
            written: i128::from(found.mtime()) * 1_000_000_000 + i128::from(found.mtime_nsec()),
            access: (found.mode(), found.uid(), found.gid()),
        }
    }
}

/// What is at a path now, next to what was there when the path was last reported.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Found {
    folder: bool,
    /// Made a moment ago.
    new: bool,
    now: Sight,
    before: Option<Sight>,
}

/// The folders being watched for one running guest. Dropping it ends the reporting; the
/// watching itself ends with the VM.
#[derive(Debug)]
pub(crate) struct Watching {
    vmm: Arc<Vmm>,
    telling: Option<JoinHandle<()>>,
}

impl Drop for Watching {
    fn drop(&mut self) {
        if let Some(telling) = &self.telling {
            telling.abort();
        }
    }
}

impl Watching {
    /// Reports to `agent`. Nothing under `home`, the engine's own folder, is reported: the VM's
    /// disk is there and changes with every write in the guest.
    pub(crate) fn start(vmm: Arc<Vmm>, agent: Caller, home: &Path) -> Self {
        let mut ignored = vec![home.to_path_buf()];
        ignored.extend(home.canonicalize());
        let telling = vmm.changes().map(|events| tokio::spawn(tell(agent, events, ignored)));
        Self { vmm, telling }
    }

    /// Watches these folders and no others.
    pub(crate) async fn set(&self, folders: &[String]) -> Result<(), String> {
        let found = folders.iter().filter_map(|folder| Path::new(folder).canonicalize().ok());
        self.vmm.watch(roots(found)).await.map_err(|error| error.to_string())
    }
}

/// Sends the changes on, in the order they happened, until the guest is gone.
async fn tell(
    agent: Caller,
    mut events: mpsc::UnboundedReceiver<Vec<FileEvent>>,
    ignored: Vec<PathBuf>,
) {
    let ignored = Arc::new(ignored);
    let mut seen = Seen::new();
    while let Some(events) = events.recv().await {
        let ignored = Arc::clone(&ignored);
        // One look at the disk for each event: not for the threads everything else waits on.
        let looking = tokio::task::spawn_blocking(move || {
            let changes = changes(&events, &ignored, &mut seen);
            (changes, seen)
        });
        let Ok((changes, remembered)) = looking.await else { return };
        seen = remembered;
        if !changes.is_empty() && agent.call::<_, ()>(&EngineCall::Changed(changes)).await.is_err()
        {
            return;
        }
    }
}

fn changes(events: &[FileEvent], ignored: &[PathBuf], seen: &mut Seen) -> Vec<Change> {
    let now = SystemTime::now();
    if seen.len() > REMEMBERED {
        seen.clear();
    }
    let mut changes = Vec::new();
    for event in events.iter().filter(|event| !is_ignored(&event.path, ignored)) {
        let found = event.path.symlink_metadata().ok().map(|found| Found {
            folder: found.is_dir(),
            new: found
                .created()
                .ok()
                .and_then(|made| now.duration_since(made).ok())
                .is_some_and(|age| age < NEW),
            now: Sight::of(&found),
            before: seen.insert(event.path.clone(), Sight::of(&found)),
        });
        if found.is_none() {
            seen.remove(&event.path);
        }
        let Some(path) = event.path.to_str() else { continue };
        let told = changed(event.flags, found).into_iter().flatten();
        changes.extend(told.map(|what| Change { path: path.to_owned(), what }));
    }
    changes
}

/// The folders to watch: each one once, and none that lies inside another.
fn roots(folders: impl Iterator<Item = PathBuf>) -> Vec<PathBuf> {
    let mut folders: Vec<PathBuf> = folders.collect();
    folders.sort();
    folders.dedup();
    let within = |folder: &Path| {
        folders.iter().any(|other| other.as_path() != folder && folder.starts_with(other))
    };
    folders.iter().filter(|folder| !within(folder)).cloned().collect()
}

/// A user's `Library` changes all day and is nobody's project; a container that mounts a whole
/// home folder would be told of every one of those changes.
fn is_ignored(path: &Path, ignored: &[PathBuf]) -> bool {
    let mut parts = path.components().skip(1).map(std::path::Component::as_os_str);
    let library = parts.next().is_some_and(|part| part == "Users")
        && parts.next().is_some()
        && parts.next().is_some_and(|part| part == "Library");
    library || ignored.iter().any(|folder| path.starts_with(folder))
}

/// What to tell the guest of one event, in order, given what is at its path now. The Mac says
/// what kinds of things happened to a path lately, several at once and in no order, so what is
/// there now settles what the event means.
fn changed(flags: u32, found: Option<Found>) -> [Option<Changed>; 3] {
    let has = |flag| flags & flag != 0;
    let Some(found) = found else {
        let was_there = has(flag::CREATED | flag::REMOVED | flag::RENAMED | flag::MODIFIED);
        return [was_there.then_some(Changed::Gone { folder: has(flag::IS_DIR) }), None, None];
    };
    let (now, before) = (found.now, found.before);
    let differs =
        |part: fn(&Sight, &Sight) -> bool| before.is_none_or(|before| part(&before, &now));
    // Renamed to, made again after it was removed, or made just now: and not the file already
    // reported at this path.
    let appeared = differs(|before, now| before.file != now.file)
        && (has(flag::RENAMED | flag::REMOVED) || (has(flag::CREATED) && found.new));
    let written = differs(|before, now| (before.size, before.written) != (now.size, now.written));
    // A folder the Mac lost track of the changes under has itself changed, as far as it can say.
    let contents =
        if found.folder { has(flag::MUST_SCAN_SUBDIRS) } else { has(flag::MODIFIED) && written };
    // Setting a file's time, as `touch` does, changes no contents but is how builds are asked
    // to run again.
    let attributes = has(flag::INODE_META | flag::OWNER | flag::XATTR)
        && (differs(|before, now| before.access != now.access) || (written && !contents));
    [
        appeared.then_some(Changed::Appeared),
        contents.then_some(Changed::Contents),
        attributes.then_some(Changed::Attributes),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    const OLD: Sight = Sight { file: 7, size: 10, written: 1_000, access: (0o100_644, 501, 20) };

    /// A file not reported before.
    const FILE: Option<Found> = Some(Found { folder: false, new: false, now: OLD, before: None });
    const NEW_FILE: Option<Found> =
        Some(Found { folder: false, new: true, now: OLD, before: None });
    const FOLDER: Option<Found> = Some(Found { folder: true, new: false, now: OLD, before: None });

    /// A file reported before as `OLD`, as it is `now`.
    fn seen_again(now: Sight) -> Found {
        Found { folder: false, new: true, now, before: Some(OLD) }
    }

    fn told(flags: u32, found: Option<Found>) -> Vec<Changed> {
        changed(flags, found).into_iter().flatten().collect()
    }

    #[test]
    fn a_folder_inside_a_watched_one_isnt_watched_twice() {
        let folders =
            ["/Users/ada/shop/web", "/Users/ada/shop", "/Users/ada/shop", "/Users/ada/blog"];
        let watched = roots(folders.into_iter().map(PathBuf::from));
        assert_eq!(watched, [PathBuf::from("/Users/ada/blog"), PathBuf::from("/Users/ada/shop")]);
    }

    #[test]
    fn a_folder_whose_name_starts_like_another_is_its_own() {
        let watched =
            roots(["/Users/ada/shop", "/Users/ada/shop-old"].into_iter().map(PathBuf::from));
        assert_eq!(watched.len(), 2);
    }

    #[test]
    fn the_library_and_the_engines_own_folder_are_left_out() {
        let ignored = [PathBuf::from("/Users/ada/.containeria")];
        assert!(is_ignored(Path::new("/Users/ada/Library/Caches/x"), &ignored));
        assert!(is_ignored(Path::new("/Users/ada/.containeria/vm/data.img"), &ignored));
        assert!(!is_ignored(Path::new("/Users/ada/shop/Library/book.rs"), &ignored));
        assert!(!is_ignored(Path::new("/Users/ada/shop/main.rs"), &ignored));
        assert!(!is_ignored(Path::new("/Volumes/Work/Library/x"), &ignored));
    }

    #[test]
    fn a_saved_file_is_contents_that_changed() {
        assert_eq!(told(flag::MODIFIED, FILE), [Changed::Contents]);
    }

    #[test]
    fn a_file_the_mac_still_calls_created_is_only_new_once() {
        let saved = flag::CREATED | flag::MODIFIED;
        assert_eq!(told(saved, NEW_FILE), [Changed::Appeared, Changed::Contents]);
        assert_eq!(told(saved, FILE), [Changed::Contents]);
        let saved_again = Sight { size: 12, written: 2_000, ..OLD };
        assert_eq!(told(saved, Some(seen_again(saved_again))), [Changed::Contents]);
    }

    #[test]
    fn what_the_mac_still_says_of_an_unchanged_file_is_not_said_again() {
        let everything =
            flag::CREATED | flag::RENAMED | flag::MODIFIED | flag::INODE_META | flag::XATTR;
        assert_eq!(told(everything, Some(seen_again(OLD))), []);
    }

    #[test]
    fn a_change_of_permissions_alone_is_only_attributes() {
        let chmod_after_save = flag::RENAMED | flag::MODIFIED | flag::INODE_META;
        let locked = Sight { access: (0o100_600, 501, 20), ..OLD };
        assert_eq!(told(chmod_after_save, Some(seen_again(locked))), [Changed::Attributes]);
    }

    #[test]
    fn a_touched_file_is_attributes_that_changed() {
        let touched = Sight { written: 5_000, ..OLD };
        assert_eq!(told(flag::INODE_META, Some(seen_again(touched))), [Changed::Attributes]);
    }

    #[test]
    fn another_file_at_a_known_path_appears() {
        let replaced = Sight { file: 8, written: 2_000, ..OLD };
        assert_eq!(
            told(flag::RENAMED | flag::MODIFIED, Some(seen_again(replaced))),
            [Changed::Appeared, Changed::Contents]
        );
    }

    #[test]
    fn a_file_saved_by_renaming_a_new_one_over_it_appears() {
        assert_eq!(told(flag::RENAMED, FILE), [Changed::Appeared]);
        assert_eq!(
            told(flag::RENAMED | flag::MODIFIED, FILE),
            [Changed::Appeared, Changed::Contents]
        );
    }

    #[test]
    fn what_is_no_longer_there_is_gone_and_said_once() {
        let made_and_removed = flag::CREATED | flag::MODIFIED | flag::REMOVED | flag::XATTR;
        assert_eq!(told(made_and_removed, None), [Changed::Gone { folder: false }]);
        assert_eq!(told(flag::RENAMED, None), [Changed::Gone { folder: false }]);
        assert_eq!(told(flag::REMOVED | flag::IS_DIR, None), [Changed::Gone { folder: true }]);
        assert_eq!(told(flag::XATTR, None), []);
    }

    #[test]
    fn what_was_removed_and_made_again_appears() {
        assert_eq!(told(flag::REMOVED | flag::CREATED, FILE), [Changed::Appeared]);
    }

    #[test]
    fn a_change_of_permissions_is_attributes() {
        assert_eq!(told(flag::INODE_META, FILE), [Changed::Attributes]);
        assert_eq!(told(flag::OWNER, FOLDER), [Changed::Attributes]);
    }

    #[test]
    fn a_folder_changes_only_when_the_mac_lost_track() {
        assert_eq!(told(flag::MODIFIED | flag::IS_DIR, FOLDER), []);
        assert_eq!(told(flag::MUST_SCAN_SUBDIRS, FOLDER), [Changed::Contents]);
    }

    #[test]
    fn looks_at_the_disk_to_say_what_an_event_means() {
        let folder = tempfile::tempdir().unwrap();
        let kept = folder.path().join("kept.txt");
        std::fs::write(&kept, "x").unwrap();
        let events = [
            FileEvent { path: kept.clone(), flags: flag::CREATED | flag::MODIFIED },
            FileEvent { path: folder.path().join("gone.txt"), flags: flag::REMOVED },
            FileEvent { path: folder.path().join("home/data.img"), flags: flag::MODIFIED },
        ];
        let mut seen = Seen::new();
        let told = changes(&events, &[folder.path().join("home")], &mut seen);
        let kept = kept.to_str().unwrap().to_owned();
        let gone = folder.path().join("gone.txt").to_str().unwrap().to_owned();
        assert_eq!(
            told,
            [
                Change { path: kept.clone(), what: Changed::Appeared },
                Change { path: kept.clone(), what: Changed::Contents },
                Change { path: gone, what: Changed::Gone { folder: false } },
            ]
        );
        // The same file at the same path, which the Mac still calls created and modified.
        assert_eq!(changes(&events[..1], &[], &mut seen), []);
        std::fs::write(&kept, "longer").unwrap();
        let saved = changes(&events[..1], &[], &mut seen);
        assert_eq!(saved, [Change { path: kept, what: Changed::Contents }]);
    }
}
