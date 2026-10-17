use std::sync::atomic::{AtomicBool, Ordering};

use containeria_engine::Home;

use crate::error::{CommandError, ErrorKind, Result};

/// Set while the engine's disks are being moved; nothing may start a VM until they're in place.
static MOVING: AtomicBool = AtomicBool::new(false);

/// Refuses to start a VM whose disks are mid-move or on a drive that isn't connected.
///
/// # Errors
/// Fails with a sentence saying what to do.
pub(crate) fn ensure_data_ready(home: &Home) -> Result<()> {
    if MOVING.load(Ordering::Acquire) {
        return Err(CommandError::new(
            ErrorKind::InvalidInput,
            "The engine's data is moving. It starts again by itself when the move is done.",
        ));
    }
    let location = containeria_engine::location(home);
    if !location.available {
        return Err(CommandError::new(
            ErrorKind::InvalidInput,
            format!(
                "The engine's data is in {}, which isn't connected. Connect the drive, or move the data in Settings → Storage.",
                location.path
            ),
        ));
    }
    Ok(())
}

/// Holds the moving flag for as long as it lives.
pub(crate) struct MoveGuard(());

impl MoveGuard {
    /// # Errors
    /// Fails when another move is running.
    pub(crate) fn take() -> Result<Self> {
        if MOVING.swap(true, Ordering::AcqRel) {
            return Err(CommandError::new(ErrorKind::InvalidInput, "The data is already moving."));
        }
        Ok(Self(()))
    }
}

impl Drop for MoveGuard {
    fn drop(&mut self) {
        MOVING.store(false, Ordering::Release);
    }
}
