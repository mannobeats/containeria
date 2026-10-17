# 2. The UI reaches Rust only through generated, typed bindings

Date: 2026-10-17. Status: accepted.

## Context

A Tauri app has a JSON boundary between TypeScript and Rust. Hand-written `invoke` calls drift from
the Rust signatures and fail at runtime.

## Decision

Use `tauri-specta` to generate `bindings.ts` from the Rust commands, events and types. Commands use
`ErrorHandlingMode::Throw` and reject with one `CommandError` shape. Continuous data uses Tauri
channels with stream ids; change notifications use events that invalidate TanStack Query caches.

## Consequences

- A renamed field or command is a TypeScript error, not a runtime failure.
- `cargo test -p containeria-app` regenerates the bindings; CI fails if the committed file is stale.
- `tauri-specta` 2 is still a release candidate, pinned with `=`; upgrades are deliberate.
- 64-bit integers must be marked when they fit a JS number, so precision loss is explicit.
