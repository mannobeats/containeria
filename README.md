# Containeria

Containers, Kubernetes, Linux machines and your databases, in one fast native app for macOS.
Open source and free for commercial use: a replacement for Docker Desktop and OrbStack.

- **Containers** grouped by Compose project, with live CPU and memory, logs, a terminal, files and
  inspect.
- **The memory ledger** shows where the engine's memory goes, project by project.
- **Kubernetes** (k3s) and **Linux machines** (Ubuntu, Debian, Fedora, Alpine and more) in the
  same engine as your containers.
- **Light on your Mac**: the engine starts in about a second and turns itself off when nothing
  runs, giving all its memory back.
- **A database browser** for Postgres, MySQL, SQLite, Redis, MongoDB and more, that finds the
  databases running in your containers.
- `docker`, `docker compose` and `kubectl` keep working as before.

Under the hood: Containeria's own engine runs the unmodified Docker Engine in a small Linux VM on
Apple Virtualization; the app is Tauri 2 with a Rust core and a React UI. See
[docs/architecture.md](docs/architecture.md), the [feature map](docs/features.md) and
[why the engine is our own](docs/adr/0004-our-own-engine.md).

## Status

In active development. The approved design prototype lives in [`design/`](design/): open
`design/index.html` in a browser.

## Development

Requirements: an Apple silicon Mac with macOS 13+, Node 26, pnpm 11, Rust (pinned by
`rust-toolchain.toml`), Xcode's command-line tools for Swift, and `cargo-deny` for `pnpm check`
(`cargo install cargo-deny --locked`).

```sh
pnpm install
sh scripts/fetch-tools.sh    # the pinned Docker CLI, Compose, Buildx and kubectl
sh scripts/build-engine.sh   # the engine and its VM helper
sh scripts/build-guest.sh    # the kernel and system image the VM boots; needs a Docker engine
pnpm dev                     # runs the app with its own engine in ~/.containeria
CONTAINERIA_DOCKER_SOCKET=/var/run/docker.sock pnpm dev   # or against any running Docker engine
pnpm check                   # the full quality gate
pnpm build                   # the .app and .dmg, with the engine and tools inside
```

A tagged commit (`v*`) builds and publishes the Apple silicon disk image through
`.github/workflows/release.yml`. It isn't signed with a Developer ID yet, so macOS asks to confirm
the first launch (right-click → Open).

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

## License

Apache-2.0. Brand logos belong to their owners and are used only to identify software; see
`apps/desktop/src/assets/logos/LICENSES.md`.
