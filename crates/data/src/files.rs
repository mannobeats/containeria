use std::path::Path;
use std::sync::{Mutex, PoisonError};

use serde::Serialize;
use serde::de::DeserializeOwned;

use crate::error::Result;

/// Reads a JSON file, or the type's default when it doesn't exist yet.
pub(crate) fn read_json<T: DeserializeOwned + Default>(path: &Path) -> Result<T> {
    match std::fs::read(path) {
        Ok(bytes) => Ok(serde_json::from_slice(&bytes)?),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(T::default()),
        Err(error) => Err(error.into()),
    }
}

/// Held for each read-change-write: commands run at the same time, and two unguarded updates lose
/// one's change or rename each other's temporary file away. One lock serves every file, as they're
/// small and rarely written.
static UPDATING: Mutex<()> = Mutex::new(());

/// Reads a JSON file (the default when missing), changes it and writes it back, with no other update
/// in between.
pub(crate) fn update_json<T: Serialize + DeserializeOwned + Default>(
    path: &Path,
    change: impl FnOnce(&mut T),
) -> Result<()> {
    let _updating = UPDATING.lock().unwrap_or_else(PoisonError::into_inner);
    let mut value = read_json(path)?;
    change(&mut value);
    write_json(path, &value)
}

/// Writes through a temporary file and a rename, so a crash never leaves half a file.
fn write_json<T: Serialize>(path: &Path, value: &T) -> Result<()> {
    if let Some(folder) = path.parent() {
        std::fs::create_dir_all(folder)?;
    }
    let temporary = path.with_extension("json.tmp");
    std::fs::write(&temporary, serde_json::to_vec_pretty(value)?)?;
    std::fs::rename(temporary, path)?;
    Ok(())
}
