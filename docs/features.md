# Containeria feature map

Every feature in the design prototype (`design/`), mapped to the part of the engine that makes it
work. Checked against the source of Colima v0.10.3, Lima v2.2.1 and krunkit v1.3.2 (October 2026).

## How the engine is built

Containeria bundles Colima, unchanged and pinned, and drives it from the app's Rust core. Everything
Colima doesn't do is Containeria's own code on top.

| Layer | What it is | License |
|---|---|---|
| App | Tauri 2, Rust core, React UI | Apache-2.0 (ours) |
| Our Rust layer | Docker API client (`bollard`), domain DNS and HTTPS proxy, file and volume browsing, migration, stats, database drivers, `cx` CLI | ours |
| Colima | VM lifecycle, profiles, runtime setup, port forwarding, mounts, k3s, Incus | MIT |
| Lima | The VM itself: Apple Virtualization (VZ) or libkrun (krunkit) | Apache-2.0 |
| Inside the VM | Docker Engine (moby), containerd, BuildKit, k3s, Incus | Apache-2.0 |

Two Colima profiles, kept in Containeria's own folder (`COLIMA_HOME`) so they never touch a Colima
the user installed:

- `containeria`: runtime `docker`, Kubernetes optional. Runs containers, images, volumes, networks, k3s.
- `containeria-machines`: runtime `incus`. Runs Linux machines. Created and started only when the
  user makes their first machine, because one Colima profile can only run one runtime. Colima
  sets Incus up only when the `incus` client is on its `PATH`. Containeria looks next to Colima
  first, then in Homebrew, so the release bundle ships `incus` beside `colima` and `limactl`.

## Legend

- **Colima**: Colima or Lima already does it; we set the config and show it.
- **Docker API**: the Docker Engine API does it; we call it through `bollard`.
- **We build**: our own Rust code on top of the engine.
- **Limited**: works, with a limit written next to it.
- **Spike**: possible, but we prove it with a small test before promising it.

## Engine

| Feature | Source | Status | Notes |
|---|---|---|---|
| Start, stop, restart the engine | `colima start/stop/restart` | Colima | |
| Engine status and uptime | `colima status --json` | Colima | |
| CPU and memory limits | `cpu`, `memory` in colima.yaml | Colima | Applied on restart. The prototype's restart banner matches this. |
| Disk size | `disk` | Limited | Can grow, never shrink. Prototype already says so. |
| VM type | `vmType: vz` or `krunkit` | Limited | Fixed when the engine is created. Changing it means re-creating the engine (data kept by export and import). |
| Rosetta for amd64 images | `rosetta: true` | Colima | VZ only, Apple Silicon. |
| amd64 without Rosetta | `binfmt: true` (QEMU) | Colima | Slower. Used automatically on krunkit. |
| Return unused memory to macOS | libkrun free page reporting | Limited | **Works only on krunkit.** On VZ, Lima attaches a memory balloon but never resizes it, so memory the VM has used stays with the VM until it restarts. See "Decisions" below. |
| Fast file sharing with your Mac | `mountType: virtiofs`, `mounts: [~]` | Colima | Home folder mounted writable at the same path, set explicitly in both profiles. |
| File-watch events (hot reload) | `mountInotify: true` | Limited | Experimental in Colima. On by default in Containeria, with a setting to turn it off. |
| SSH agent forwarding | `forwardAgent: true` | Colima | |
| Docker daemon settings (mirrors, insecure registries) | `docker:` maps to daemon.json | Colima | |
| Provision scripts | `provision:` | Colima | Advanced settings. |
| Nested virtualization | `nestedVirtualization: true` | Limited | M3 or newer, VZ only. |
| GPU and local AI models | `vmType: krunkit` + `colima model` | Limited | Experimental. A later feature, not in the prototype. |
| Boot time shown in the prototype (2.1 s) | | Spike | Invented for the design. Measure real Colima VZ boot before we show a number. |

## Containers

| Feature | Source | Status | Notes |
|---|---|---|---|
| List, start, stop, restart, pause, delete | containers API | Docker API | |
| Live CPU, memory, network, disk stats | `/containers/{id}/stats` stream | Docker API | |
| Live state changes without polling | `/events` stream | Docker API | |
| Group by Compose project | `com.docker.compose.*` labels | Docker API | |
| Deploy, edit, rebuild, pull, remove a project | Docker Compose CLI | Built | Paste YAML, open or drop a `compose.yaml`. Compose is Apache-2.0; the app looks for `bin/docker-compose` in its bundle, then the Docker CLI plugin, then Homebrew. Pasted projects live in `~/.containeria/compose/<name>`. |
| Logs with follow, filter, levels | `/containers/{id}/logs` | Docker API | Levels parsed by us. |
| Terminal into a container | exec API with TTY | Docker API | |
| Debug shell for minimal images | sidecar container sharing PID and network namespaces | We build | Same idea as `docker debug`. |
| Files tab: browse, download, upload | `/containers/{id}/archive` GET and PUT | Docker API | |
| Open container files in Finder | NFS export from the VM, mounted on macOS | Spike | Not in Colima. Prototype shows the button. |
| Inspect JSON | `/containers/{id}/json` | Docker API | |
| Rename, recreate, commit, export | containers API | Docker API | |
| Published ports open on localhost | Lima port forwarding | Colima | TCP by default. |
| UDP ports | `portForwarder: grpc` | Limited | Experimental in Colima. We default to `grpc` only after testing. |
| Port conflict detection and the "use 5433" fix | check host ports, recreate with a new mapping | We build | |
| Run container sheet | create + start API, Docker Hub search API | Docker API | |

## Domains and HTTPS

| Feature | Source | Status | Notes |
|---|---|---|---|
| `name.project.containeria.local` for every container | our DNS server (127.0.0.1:15353) + `/etc/resolver/containeria.local` | Built | `crates/net`. Colima's `dnsHosts` only resolves inside the VM, so Mac-side names are ours. Admin password once, through a macOS prompt the user starts. |
| Reaching containers with no published port | a routing proxy container inside the VM, joined to every network, reached through one forwarded port | Not yet | The proxy routes to published ports today; an unpublished one shows "Port not published". The in-VM routing container needs a running Colima engine to build and test. |
| Local HTTPS with a trusted certificate | our local CA (rcgen), trusted in the login keychain once | Built | Leaf certificates issued per host on first use, valid 397 days (Apple's limit is 825). Proxy on 80/443 when free, else 7080/7443. |
| Custom routes like `shop.test` | same proxy | Built | Saved in `~/.containeria/net/settings.json`. |
| Direct container IP from the Mac | `network.address: true` + a route to the bridge | Limited | Needs admin. Off by default, as in the prototype. |
| `*.k8s.containeria.local` for services | proxy reads k3s services | We build | |

## Images, volumes, networks

| Feature | Source | Status | Notes |
|---|---|---|---|
| List, pull with layer progress, push, tag, delete | images API | Docker API | |
| Disk usage and clean-up | `/system/df`, prune APIs | Docker API | |
| Layers and history | `/images/{id}/history` | Docker API | |
| Docker Hub search | Docker Hub API | We build | |
| Vulnerability scan | Trivy (Apache-2.0) run as a container | We build | |
| Build from a Dockerfile | BuildKit | Docker API | |
| Volumes: list, size, used by | volumes API + `/system/df` | Docker API | |
| Browse volume files | short-lived helper container mounting the volume | We build | |
| Back up, clone, export a volume | helper container with tar | We build | |
| Networks: list, create, connect, inspect | networks API | Docker API | |

## Kubernetes

| Feature | Source | Status | Notes |
|---|---|---|---|
| Turn on and off, pick version | `kubernetes.enabled`, `version` (k3s) | Colima | |
| Pods, deployments, services, ingress, config | Kubernetes API via `kube-rs` | We build | |
| Pod logs, terminal, events, YAML | Kubernetes API | We build | |
| Apply YAML, scale, restart, port-forward | Kubernetes API | We build | |
| Images built locally usable in k3s | Docker runtime shares images | Colima | |
| LoadBalancer services on localhost | k3s service load balancer + Lima port forwarding | Colima | |
| Reset cluster | delete and re-enable k3s | We build | |

## Linux machines

| Feature | Source | Status | Notes |
|---|---|---|---|
| Ubuntu, Debian, Fedora, Arch, Alpine, NixOS, openSUSE, Rocky, Kali | Incus system containers in the `containeria-machines` profile | Colima | Incus images server. |
| Full VMs instead of system containers | Incus VMs | Limited | M3 or newer only. |
| Terminal and files | `incus exec`, `incus file` | We build | |
| `ssh name@containeria` | small SSH gateway in our Rust core | We build | |
| Mac home folder inside the machine | Incus disk device of the virtiofs mount | We build | |
| amd64 machines | Rosetta or binfmt | Limited | Same rules as containers. |
| Engine shell | `colima ssh` | Colima | |

## Data browser

None of this depends on the engine. It runs in the app's Rust core.

| Feature | Source | Status |
|---|---|---|
| Auto-detected databases in containers, credentials from container env | Docker API inspect + our matcher | We build |
| PostgreSQL, Neon, Supabase, Timescale | `sqlx` / `tokio-postgres` | We build |
| MySQL, MariaDB, PlanetScale | `sqlx` / `mysql_async` | We build |
| SQLite, Turso (libSQL) | `rusqlite`, `libsql` | We build |
| ClickHouse | `clickhouse` crate | We build |
| SQL Server | `tiberius` | We build |
| MongoDB | `mongodb` crate | We build |
| Redis | `redis` crate | We build |
| DynamoDB | AWS SDK for Rust | We build |
| Grid, inline edits, pending changes, commit | our code | We build |
| Filters, sort, pagination pushed into SQL | our query builder | We build |
| SQL editor with schema autocomplete | CodeMirror 6 + schema reads | We build |
| Schema diagram | React Flow + elkjs | We build |
| Import and export CSV, JSON, SQL, Parquet | our code (Arrow for Parquet) | We build |
| Passwords in the macOS Keychain | `keyring` crate | We build |
| Read-only safe mode for production | our code | We build |
| SSH tunnels | `russh` | We build |

## The app around it

| Feature | Source | Status | Notes |
|---|---|---|---|
| Menu bar item and popover | Tauri tray | We build | |
| Memory shown in the menu bar | host memory of the VM process + guest `/proc/meminfo` | We build | |
| Memory ledger (per project) | Docker stats + k3s metrics + Incus state | We build | The "returned to macOS" segment is real only on krunkit. |
| Activity charts | same sources, sampled | We build | |
| ⌘K command palette, shortcuts | our UI | We build | |
| Settings | colima.yaml + our own settings | We build | |
| Launch at login, auto-update | Tauri plugins | We build | |
| First launch and import from Docker Desktop | `docker save`/`load`, volume tar copy, recreate from inspect | We build | |
| `docker`, `docker compose`, `kubectl` on the PATH | bundled CLIs, Docker context set by Colima | Colima | `autoActivate: true`. |
| `cx` command-line tool | `crates/cli` | Built | `cx ps`, `start`, `stop`, `restart`, `logs -f`, `open`, `engine start\|stop\|status`, `data`. Works without the app. |
| Collect diagnostics | Colima and Lima logs + our logs | We build | |

## Decisions this map forces

1. **Memory back to macOS is a VM choice, not a toggle.** It needs krunkit, which loses Rosetta
   and is still experimental. VZ keeps Rosetta and is the stable default but holds memory until
   restart. The prototype's "Return unused memory to macOS" switch becomes a choice made when the
   engine is created, and the ledger hides the "returned" segment on VZ. Long term this is the one
   place we may need our own VM driver.
2. **Two VMs when Linux machines are used.** Docker and Incus can't share one Colima profile.
   The second VM starts only when the user creates a machine.
3. **Domains, HTTPS and the data browser are ours.** Colima has nothing for them, and they are
   where Containeria stands apart.
4. **Every invented number in the prototype gets measured** before it ships: boot time, memory
   use, and the Docker Desktop comparison line.
