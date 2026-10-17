# Rust conventions

- Edition 2024, toolchain pinned in `rust-toolchain.toml`. Workspace lints in the root
  `Cargo.toml` apply to every crate through `[lints] workspace = true`.
- Clippy `pedantic` is on and warnings fail the gate. When a lint is wrong for one item, use
  `#[expect(lint, reason = "...")]` on that item, never `allow`, and never at crate level.
- `unsafe` is forbidden. Use a maintained crate that wraps the platform API instead.
- No `unwrap`, `expect` or `panic!` outside tests. Return errors.
- Errors: each crate has one `Error` enum (`thiserror`) and `pub type Result<T, E = Error>`. The app
  shell maps crate errors to `CommandError` in `src-tauri/src/error.rs`; messages are sentences a
  person can act on.
- Domain crates expose small, fully populated types (`ContainerSummary`, not bollard's
  `Option`-everywhere models). Conversion lives in a `From` impl next to the type.
- Inside `apps/desktop/src-tauri`, items are `pub(crate)`; it is not a library.
- Async: `tokio`. Streams returned from crates are `impl Stream<Item = Result<T>> + use<>`; callers
  `pin!` them.
- Shared mutable state: `tokio::sync::RwLock` for data awaited across `.await`, `std::sync::Mutex`
  for short critical sections. Recover a poisoned lock with `PoisonError::into_inner`.
- Paths and processes: `std::path`, `tokio::process::Command` with `kill_on_drop(true)`.
- Dependencies are declared once in `[workspace.dependencies]` with an exact current version and
  referenced with `.workspace = true`. Run `cargo deny check` after adding one.
- Tests sit in a `#[cfg(test)] mod tests` at the bottom of the file they test. Name them after the
  behaviour: `shows_a_port_published_on_ipv4_and_ipv6_once`.
- Doc comments on public items say what a caller needs to know (`# Errors` for fallible functions).
  No comments that narrate code.
