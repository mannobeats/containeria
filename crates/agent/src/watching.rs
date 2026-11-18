//! Changes to the Mac's files, which the guest's kernel can't see happen.
//!
//! The agent tells the engine which of the Mac's folders running containers have mounted; the
//! engine watches those on the Mac and says what changed; the agent tells the kernel. The kernel
//! raises the events for whatever watches the files in a container, and stops trusting what it
//! remembers of them, which would otherwise be the old file for a second more.

use std::collections::HashMap;
use std::fs;
use std::io::{self, Write};
use std::sync::Arc;
use std::time::Duration;

use contena_agent::changes::{self, RELAY, share_of};
use contena_proto::{AgentCall, Change};
use tokio::io::AsyncBufReadExt;

use crate::docker;
use crate::log;
use crate::serve::Engine;

/// Container starts and ends: `{"type":["container"],"event":["start","die"]}`.
const STARTS_AND_ENDS: &str =
    "%7B%22type%22%3A%5B%22container%22%5D%2C%22event%22%3A%5B%22start%22%2C%22die%22%5D%7D";
/// Containers of one project start together; one look at Docker's list covers them all.
const SETTLE: Duration = Duration::from_millis(100);

/// Keeps the engine told of the folders under `shares` that running containers have mounted,
/// for as long as the guest runs.
pub(crate) async fn follow(engine: Engine, shares: Arc<[String]>) {
    let mut told = None;
    loop {
        // Docker's events end when Docker does; the agent starts it again a moment later.
        let _ = follow_docker(&engine, &shares, &mut told).await;
        tokio::time::sleep(Duration::from_secs(1)).await;
    }
}

async fn follow_docker(
    engine: &Engine,
    shares: &[String],
    told: &mut Option<Vec<String>>,
) -> io::Result<()> {
    let mut events = docker::events(STARTS_AND_ENDS).await?;
    let mut event = String::new();
    loop {
        tell(engine, shares, told).await?;
        event.clear();
        if events.read_line(&mut event).await? == 0 {
            return Ok(());
        }
        // Only that something happened matters, so an event cut short by the wait loses nothing.
        while let Ok(read) = tokio::time::timeout(SETTLE, events.read_line(&mut event)).await {
            if read? == 0 {
                return Ok(());
            }
            event.clear();
        }
    }
}

async fn tell(
    engine: &Engine,
    shares: &[String],
    told: &mut Option<Vec<String>>,
) -> io::Result<()> {
    let containers = docker::api("GET", "/containers/json").await?;
    let mounted = changes::mounted(&containers, shares)?;
    if told.as_ref() == Some(&mounted) {
        return Ok(());
    }
    match engine.call(AgentCall::Watch(mounted.clone())).await {
        Ok(()) => *told = Some(mounted),
        Err(error) => log(format_args!("the Mac's folders aren't watched for changes: {error}")),
    }
    Ok(())
}

/// Tells the kernel of `changes`, in order.
pub(crate) async fn report(changes: Vec<Change>, shares: Arc<[String]>) {
    // Each one is a file lookup or more on the Mac: not for the threads everything else waits on.
    let _ = tokio::task::spawn_blocking(move || tell_kernel(&changes, &shares)).await;
}

fn tell_kernel(changes: &[Change], shares: &[String]) {
    let Ok(relay) = fs::OpenOptions::new().write(true).open(RELAY) else { return };
    // Asked once for each share. With nothing watching there are no events to raise, and the
    // kernel is spared looking each file up on the Mac.
    let mut watched = HashMap::new();
    for change in changes {
        let Some(share) = share_of(&change.path, shares) else { continue };
        let is_watched = *watched
            .entry(share)
            .or_insert_with(|| (&relay).write(&changes::watched(share)).is_ok());
        let told = if is_watched { changes::record(change) } else { changes::forget(&change.path) };
        // A path that changed again since, or is gone with its folder, has nothing to raise.
        let _ = (&relay).write(&told);
    }
}
