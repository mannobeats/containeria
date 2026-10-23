# Architecture

## Layers

| Layer | Where | Job |
|---|---|---|
| UI | `apps/desktop/src` | React views. Reads state through TanStack Query, never holds a copy of engine state. |
| App shell | `apps/desktop/src-tauri` | Tauri commands, events, streams, tray, windows. Thin: translates between the UI and the crates. |
| Domain crates | `crates/*` | One per engine area. Plain async Rust, no Tauri types, testable without a window. |
| Engine | Colima + Lima + Docker in the VM | Pinned and unchanged. Driven through the Colima CLI and the Docker API. |

`crates/engine` runs Colima. `crates/docker` wraps the Docker Engine API (`bollard`). New areas
(Kubernetes, Linux machines, data browser, domains) each get their own crate and never depend on
each other; the app shell composes them.

## How the UI talks to Rust

Three channels, all typed by `tauri-specta`. The generated `apps/desktop/src/lib/ipc/bindings.ts` is
the only way the UI reaches Rust.

1. **Commands** for request and response. Every command is `async`, takes `State<'_, AppState>`
   and returns `Result<T, CommandError>`. `CommandError` has a `kind` the UI branches on
   (`engineStopped`, `notFound`, ...) and a sentence for people.
2. **Events** for "something changed, refetch": `EngineChanged`, `DockerChanged`, `MetricsUpdated`.
   The UI turns them into TanStack Query invalidations in `app/use-engine-events.ts`; views never
   poll for state an event already announces.
3. **Streams** for continuous data a view shows while open (stats, logs, terminal output). The
   command takes a `tauri::ipc::Channel<T>`, spawns the work through `Streams::spawn` and returns
   a stream id; the UI subscribes with `useStream` and cancels on unmount with `stream_cancel`.

### Adding a command

1. Put the logic in the domain crate, returning its own types and errors.
2. Add a thin `#[tauri::command] #[specta::specta]` function in `src-tauri/src/commands/<area>.rs`.
3. Register it in `src-tauri/src/ipc.rs`.
4. Run `cargo test -p containeria-app` to regenerate `bindings.ts`, and commit both.
5. Wrap it in a query or mutation hook in `src/features/<area>/api.ts`.

Types crossing the boundary derive `serde::Serialize` and `specta::Type`, use `camelCase`, and mark
`u64`/`i64` fields `#[specta(type = specta_typescript::Number)]` only when the value fits a JS
number (byte counts, timestamps).

## Background work

The app starts two long-lived tasks in `lib.rs` setup:

- `Engine::watch` connects to Docker when the engine is up, relays Docker events and notices when it
  goes away.
- `metrics::Sampler::run` samples every running container's CPU and memory every two seconds and
  builds the memory ledger. One sampler feeds the list, the ledger, the menu bar and Activity.

## Windows and the menu bar

- `main` is the app window. With "Keep running in the menu bar" on, closing it hides it; the Dock
  icon, opening the app again, or the menu bar popover brings it back.
- `tray` is the menu bar popover: a borderless webview built from `tray.html`
  (`src/tray/main.tsx`), drawn on the native popover material, shown under the tray icon and
  hidden when it loses focus.
- `settings` is the Settings window, built from `settings.html` (`src/settings/main.tsx`), as a
  Mac app has one: opened with ⌘, or `settings_open(pane)`, the pane's name in its title bar and a
  toolbar of panes. Rust holds the shown pane (`settings_window.rs`) and announces changes with
  `SettingsPaneShown`, so the menu, links and the toolbar all go through one path.
- The popover and Settings size themselves to their content with `window_fit` (`lib/fit-window.ts`).
- Every window shares the same commands and hooks, and `behaveNatively()`: focus rings only for
  keyboard use, and no WebKit context menu outside text.
- The native menu (`src-tauri/src/menu.rs`) emits `Navigate(path)`; the UI opens that path.
- App preferences that aren't engine settings live in `~/.containeria/settings.json`
  (`preferences.rs`); engine settings live in `colima.yaml`.

## Engine state

`~/.containeria` is Containeria's home (`$CONTAINERIA_HOME` overrides it). Colima runs with
`COLIMA_HOME=~/.containeria/colima`, so it never touches a Colima the user installed. The containers
profile is `containeria`; Linux machines use `containeria-machines`. See docs/features.md for what
each profile can do.

`CONTAINERIA_DOCKER_SOCKET` points the app at any other Docker engine (the phase reads `external`),
which is how the UI is developed and tested without starting a VM.
