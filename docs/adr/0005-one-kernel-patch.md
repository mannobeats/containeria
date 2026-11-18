# 5. The guest's kernel carries one patch

Date: 2026-11-17. Status: accepted. Changes two consequences of
[4. Our own engine](0004-our-own-engine.md): the kernel is no longer built unpatched, and
file-watch events and SSH agent forwarding are no longer left out.

## Context

A file changed on the Mac changes inside a container that has its folder mounted, through
Apple's file sharing (virtiofs). Two things were wrong with that, and both are in the guest's
kernel:

- No system call in the guest made the change, so Linux raises no inotify event. Programs that
  reload when a file changes never do.
- FUSE, which virtiofs is, trusts what it last heard about a name and a file for as long as the
  host says it may: about a second here. A file saved on the Mac kept its old size in a
  container for that long, and one saved by renaming a new file over it, as vim and JetBrains
  editors save, could not be opened at all.

The Mac knows when a file changes (FSEvents). Nothing in an unpatched kernel lets a program
raise an inotify event without changing the file, or end FUSE's trust in one path.

## Decision

`guest/patches/0001-fsnotify-relay.patch` adds `/proc/fs/fsnotify_relay`. The agent writes each
change the engine reports to it; the kernel stops trusting what it cached of that path and
raises the events the change would have raised had it been made in the guest.

The engine side is in [architecture.md](../architecture.md): the agent names the Mac's folders
running containers have mounted, the VM helper watches them, the engine says what changed.

Rejected: touching the file from the guest to make Linux raise an event, as Lima does. It
writes to the user's files, can't raise "created" or "deleted", and leaves the stale second.

## Consequences

- The patch is ours to carry to each kernel release. It is one new file and two lines of build
  glue, uses only functions the kernel's own filesystems use, and `guest/Dockerfile` fails the
  build when it no longer applies. `crates/engine/tests/engine.rs` fails when it stops working.
- A change a container makes itself comes back from the Mac and is raised a second time. The
  Mac doesn't say who made a change, and dropping what looks like an echo would sometimes drop
  a real change.
- A second patch was tried and thrown away: one that made the guest give memory back in whole
  Mac pages, lowest address first, in blocks of up to 1 MB. Apple's VM marks returned memory as
  macOS's to take, and macOS takes it when it gets to it; the patched and unpatched guests made
  the same amount takeable (measured: 1.7 GB and 1.8 GB left in use with the guest at 1.6 GB),
  and neither made macOS take it sooner. See "Memory back to macOS" in
  [features.md](../features.md).
