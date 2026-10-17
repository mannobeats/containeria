# Containeria

Containers, Kubernetes, Linux machines and your databases, in one fast native app for macOS.
Open source and free for commercial use: a replacement for Docker Desktop and OrbStack.

- **Containers** grouped by Compose project, with live CPU and memory, logs, a terminal, files and
  inspect.
- **The memory ledger** shows where the engine's memory goes, project by project.
- **Kubernetes** (k3s) and **Linux machines** (Incus) in the same engine.
- **A database browser** for Postgres, MySQL, SQLite, Redis, MongoDB and more, that finds the
  databases running in your containers.
- `docker`, `docker compose` and `kubectl` keep working as before.

Under the hood: [Colima](https://github.com/abiosoft/colima) and Lima run the Linux VM; Containeria
is a Tauri 2 app with a Rust core and a React UI. See [docs/architecture.md](docs/architecture.md)
and the [feature map](docs/features.md).

## Status

In active development. The approved design prototype lives in [`design/`](design/): open
`design/index.html` in a browser.

## Development

Requirements: macOS 13+, Node 26, pnpm 11, Rust (pinned by `rust-toolchain.toml`), and for the
engine `brew install colima incus` (Colima starts Incus for Linux machines only when its client is on `PATH`).

```sh
pnpm install
pnpm dev                     # runs the app with its own engine in ~/.containeria
CONTAINERIA_DOCKER_SOCKET=/var/run/docker.sock pnpm dev   # or against any running Docker engine
pnpm check                   # the full quality gate
```

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

## License

Apache-2.0. Brand logos belong to their owners and are used only to identify software; see
`apps/desktop/src/assets/logos/LICENSES.md`.
