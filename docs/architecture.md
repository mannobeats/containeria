# Architecture

## Layers

| Layer | Where | Job |
|---|---|---|
| UI | `apps/desktop/src` | React views. Reads state through TanStack Query, never holds a copy of engine state. |
| App shell | `apps/desktop/src-tauri` | Tauri commands, events, streams, tray, windows. Thin: translates between the UI and the crates. |
| Domain crates | `crates/*` | One per engine area. Plain async Rust, no Tauri types, testable without a window. |
| Engine | `crates/engine`, `vmm/`, `guest/`, `crates/agent` | Contena's own: a VM that runs the unmodified Docker Engine. See "The engine" below. |

`crates/docker` wraps the Docker Engine API (`bollard`). The areas (Kubernetes, Linux machines,
data browser, domains) each get their own crate; the app shell composes them.

## The engine

```
docker, compose, the app, cx
        │  ~/.contena/run/docker.sock
contena-engine ──── contena-vmm ──── the guest
  (crates/engine)        (vmm/, Swift)        kernel + agent (crates/agent) + Docker
```

- **`contena-engine`** is one process, started by the app or `cx engine start` and running
  until it is stopped. It owns the VM, Docker's socket on the Mac and the ports containers
  publish. With nothing running in the VM it turns it off (`Asleep`); the next connection to the
  socket boots it again. `contena_engine::Engine` is how the app and `cx` start it, ask its
  status and stop it, over `run/engine.sock`.
- **`contena-vmm`** is the part that speaks to Apple's frameworks. It runs the VM with Apple
  Virtualization and watches the Mac's folders for changes. Its standard input is a socket to
  the engine: lines of JSON, and the descriptor of each connection into or out of the guest. It
  is the only binary with the virtualization entitlement, and the VM stops when the engine's end
  closes.
- **The guest** boots our kernel from a read-only system image (`guest/Dockerfile`) with the
  agent as process 1. The kernel is the LTS release with one patch of ours
  (`guest/patches`, which says what it is for). The agent mounts the system, starts Docker, and
  listens on three ports of the VM's socket device: calls both ways (`crates/proto`), Docker's
  socket byte for byte, and connections to forward. Docker runs the agent as its port proxy,
  which is how a published port is listened for on the Mac before its container starts.
- **The Mac, from the guest**: the guest connects to one port the engine listens on, and names
  where on the Mac the connection goes. The agent takes the address `198.18.0.1` for the Mac:
  TCP sent there is carried to the Mac's own `localhost`, DNS asked there is answered for
  `host.docker.internal` and passed to the Mac's resolver for every other name, and
  `/run/host-services/ssh-auth.sock` is the Mac's SSH agent.
- **Changes to the Mac's files**: the agent tells the engine which of the Mac's folders running
  containers have mounted; the helper watches them; the engine tells the agent what changed; the
  kernel raises the events for watchers and stops trusting what it had cached of those paths.
- **Three sockets into the guest**: `docker.sock` is for work; using it wakes the VM and keeps it
  awake. `docker-watch.sock` is for watchers: it answers only while the VM runs and never counts
  as use. A task in the app that polls or follows events uses `Engine::watching()`; a command
  the user gave uses `Engine::docker()`. `inside.sock` leads to any address in the guest's
  network, as the watchers' socket does to Docker; the domain proxy reaches containers that
  publish no port through it.
- **Kubernetes** is k3s, fetched and run by the agent with Docker as its runtime. The engine
  writes the `contena` kubeconfig context and publishes the API and service ports.
- **Linux machines** are containers, made by `crates/machines` through the Docker API.

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
4. Run `cargo test -p contena-app` to regenerate `bindings.ts`, and commit both.
5. Wrap it in a query or mutation hook in `src/features/<area>/api.ts`.

Types crossing the boundary derive `serde::Serialize` and `specta::Type`, use `camelCase`, and mark
`u64`/`i64` fields `#[specta(type = specta_typescript::Number)]` only when the value fits a JS
number (byte counts, timestamps).

## Background work

The app starts its long-lived tasks in `lib.rs` setup, among them:

- `Engine::watch` connects to Docker when the engine is up, relays Docker events and notices when it
  goes away.
- `Engine::stay_awake_while_shown` holds the engine's VM awake while a window of the app shows,
  and lets it sleep when the app is only in the menu bar.
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
- App preferences that aren't engine settings live in `~/.contena/settings.json`
  (`preferences.rs`); engine settings live in `~/.contena/engine.json`.

## Engine state

`~/.contena` is Contena's home (`$CONTENA_HOME` overrides it): `engine.json` (settings),
`run/` (sockets and the lock that keeps the engine to one process), `vm/` (the data disk, or a
link to where it was moved), `log/` (the engine's log and the guest's console).

`CONTENA_DOCKER_SOCKET` points the app at any other Docker engine (the phase reads `external`),
which is how the UI is developed and tested without starting a VM.
