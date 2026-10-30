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
| Data location | `LIMA_HOME` moved, a link left in its place | Built | Settings → Storage moves every VM disk to another folder or drive (APFS or Mac OS Extended) and back. Copies only the data in sparse disks, swaps the link in one rename, and starts again what was running. Lima follows the link, so the new path must leave room for its 104-byte socket paths. |
| VM type | `vmType: vz` or `krunkit` | Limited | Fixed when the engine is created. Changing it means re-creating the engine (data kept by export and import). `scripts/fetch-tools.sh` bundles krunkit 1.3.2 with its libraries and EFI firmware. Colima 0.10.3 hands Lima `mountType: 9p` for krunkit, which Lima rejects (abiosoft/colima#1607, fix in #1641, unreleased), so Containeria writes `mountType: virtiofs` to `$LIMA_HOME/_config/override.yaml` before every start. |
| Rosetta for amd64 images | `rosetta: true` | Colima | VZ only, Apple Silicon. |
| amd64 without Rosetta | `binfmt: true` (QEMU) | Colima | Slower. Used automatically on krunkit. |
| Return unused memory to macOS | libkrun free page reporting | Limited | **Works only on krunkit, and only in part.** The guest reports freed pages and libkrun marks them `MADV_FREE`: pages macOS had already compressed or swapped are dropped at once (0.6 to 1.7 GB within 5 s of freeing 2 GB in tests), but freed pages still resident stay with krunkit and get compressed like any other memory under pressure. The process footprint never drops, so measure system free memory and compressor size. Guest page cache is not free memory and is never returned. On VZ the balloon lacks free page reporting and nothing comes back until restart. See "Decisions" below. |
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
| Rename, recreate, commit, export | containers API | Built | Recreate keeps name, ports, networks and anonymous volumes; the old container goes only once the new one exists. |
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
| `*.k8s.containeria.local` for services | proxy reads k3s services | Built | `<service>.<namespace>.k8s.containeria.local` for LoadBalancer and NodePort services, through the port Lima forwards to the Mac. ClusterIP-only services aren't reachable from the Mac. |

## Images, volumes, networks

| Feature | Source | Status | Notes |
|---|---|---|---|
| List, pull with layer progress, push, tag, delete, export | images API, `docker push` | Built | Push goes through the Docker CLI so `docker login` credentials and helpers work; export writes a `docker save` archive. |
| Disk usage and clean-up | `/system/df`, prune APIs | Docker API | Settings → Storage: images, stopped containers, volumes and the build cache, each with its own clean-up. |
| Layers and history | `/images/{id}/history` | Docker API | |
| Docker Hub search | Docker Hub API | We build | |
| Vulnerability scan | Trivy (Apache-2.0) run as a container | Built | `aquasec/trivy` pinned, docker socket mounted, database cached in the `containeria-trivy-cache` volume. |
| Build from a Dockerfile | BuildKit through `docker build` | Built | Build sheet or drop a Dockerfile on the window; plain BuildKit progress streams into the run sheet. |
| Build history | `docker buildx history` (`ls`, `inspect`, `logs`, `rm`) on the engine's `default` builder | Built | Builds from the app and from `docker build` or `docker compose build` in a terminal: running ones first with live output, then the history with duration, cache hits, build arguments and the failing step. BuildKit only counts steps when a build ends, so a running build's bar is indeterminate. |
| Volumes: list, size, used by | volumes API + `/system/df` | Docker API | |
| Browse volume files | short-lived helper container mounting the volume | We build | |
| Back up, restore, clone, export a volume | helper container with tar | Built | Restore takes Containeria backups and plain tar or tar.gz archives of a volume's files. |
| Networks: list, create, connect, inspect | networks API | Docker API | |

## Kubernetes

| Feature | Source | Status | Notes |
|---|---|---|---|
| Turn on and off, pick version | `kubernetes.enabled`, `version` (k3s) | Colima | |
| Pods, deployments, services, ingress, config | Kubernetes API via `kube-rs` | We build | |
| Pod logs, terminal, events, YAML | Kubernetes API | Built | The terminal is `kubectl exec -it` through kube-rs, with a container picker. |
| Apply YAML, scale, restart, port-forward, namespaces | Kubernetes API | Built | Deployments edit their YAML in place; New Namespace…; Copy kubeconfig Path. |
| Images built locally usable in k3s | Docker runtime shares images | Colima | |
| LoadBalancer services on localhost | k3s service load balancer + Lima port forwarding | Colima | |
| Reset cluster | delete and re-enable k3s | We build | |

## Linux machines

| Feature | Source | Status | Notes |
|---|---|---|---|
| Ubuntu, Debian, Fedora, Arch, Alpine, NixOS, openSUSE, Rocky, Kali | Incus system containers in the `containeria-machines` profile | Colima | Incus images server. |
| Full VMs instead of system containers | Incus VMs | Limited | M3 or newer only. |
| Terminal and files | `incus exec`, `incus file` | We build | |
| The machines VM only runs while it has work | `colima start`/`stop` of `containeria-machines` | Built | Starting a machine starts the VM. After five minutes with no machine running, no Incus operation and no shell open, it stops and its memory goes back to macOS. The list stays, read from `~/.containeria/machines/known.json`. |
| Open in Terminal App, Copy Shell Command | the `incus` client next to Colima, with its own config in `~/.containeria/incus` | Built | Opens a `.command` file from `~/.containeria/terminal`, so macOS asks for no Automation permission. |
| Snapshots: take, restore, delete | Incus snapshots | Built | Restoring a running machine restarts it. |
| Clone | Incus instance copy, without snapshots | Built | The copy is stopped. Running system containers copy as they are on disk. |
| Export and import | Incus backups (`.tar.gz`, without snapshots) | Built | Streams to and from the file. An import gets new MAC addresses, so it runs beside its original. |
| `ssh name@containeria` | small SSH gateway in our Rust core | We build | |
| Mac home folder inside the machine | Incus disk device of the virtiofs mount | We build | |
| amd64 machines | Rosetta or binfmt | Limited | Same rules as containers. |
| Engine shell | privileged busybox entering PID 1 with `nsenter` | Built | Engine → Open Engine Shell: root in the VM, without needing `colima` on the PATH. |

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
| MongoDB | `mongodb` crate | Built: browse, `find` and `aggregate` query tabs in Extended JSON, grid edits as `updateOne`/`deleteOne`/`insertOne`. |
| Redis | `redis` crate | We build |
| DynamoDB | AWS SDK for Rust | We build |
| Grid, inline edits, pending changes, commit | our code | We build |
| Filters, sort, pagination pushed into SQL | our query builder | We build |
| SQL editor with schema autocomplete | CodeMirror 6 + schema reads | We build |
| Schema diagram | React Flow + elkjs | We build |
| Import and export CSV, JSON, SQL, Parquet | our code (Arrow for Parquet) | Built: CSV and JSON import (streamed, one transaction), CSV/JSON/SQL export. Parquet not yet. Truncate and drop with confirmation. |
| Passwords in the macOS Keychain | `keyring` crate | We build |
| Read-only safe mode for production | our code | We build |
| SSH tunnels | `russh` | Built: agent, Ed25519/ECDSA key or password; host keys checked against `~/.ssh/known_hosts` and the app's own list. RSA key files aren't supported (the `rsa` crate has an open advisory). |

## The app around it

| Feature | Source | Status | Notes |
|---|---|---|---|
| Menu bar item and popover | Tauri tray | We build | |
| Memory shown in the menu bar | host memory of the VM process + guest `/proc/meminfo` | We build | |
| Memory ledger (per project) | Docker stats + k3s metrics + Incus state | We build | The "returned to macOS" segment is real only on krunkit. |
| Activity charts | same sources, sampled | We build | |
| ⌘K command palette, shortcuts | our UI | We build | |
| Settings | colima.yaml + our own settings | We build | |
| Launch at login | Tauri autostart plugin, a LaunchAgent passing `--at-login` | Built | On once first launch is finished or skipped. A login launch stays in the menu bar without the window. |
| Engine starts with the app | `engine::start_with_app` when the engine is stopped | Built | On by default (General settings), so after a Mac restart the engine and containers with a restart policy come back. A never-created or broken engine waits for the user. |
| Auto-update | Tauri updater | We build | Needs Developer ID signing first. |
| First launch and import from another engine | `docker save`/`load`, volume tar copy, recreate from inspect | Built | Images, named volumes with their files, and containers with ports, settings, networks and Compose labels. Also File → Import from Another Engine. The source only gets short-lived helper containers to read volumes. |
| Engines it imports from | the sockets each engine leaves on disk, never its CLI | Built | Docker Desktop (`~/.docker/run/docker.sock`), OrbStack (`~/.orbstack/run/docker.sock`), Rancher Desktop (`~/.rd/docker.sock`), every Colima profile (`$COLIMA_HOME/<profile>/docker.sock`, default `~/.colima`), every Lima instance made from the Docker template (`$LIMA_HOME/<instance>/sock/docker.sock`, default `~/.lima`) and every Podman 5 machine (`$TMPDIR/podman/<machine>-api.sock`, Docker-compatible API). Each profile, instance or machine is its own source, named like "Colima (default)". Containeria's own Colima home (`~/.containeria/colima`) and its own socket are never offered. Podman 4's sockets under `~/.local/share/containers/podman/machine` aren't looked for. Any of them running is shown in the import view with why it matters: an engine that starts can take the Docker CLI's current context. |
| Volumes copied faithfully | volume inspect, archive API on both daemons | Built | The target volume is created with the source's driver, labels (`com.docker.compose.*` included, so Compose adopts it) and options. An NFS, CIFS or tmpfs volume keeps its options and its files stay where they live; a bind into the old VM becomes a plain volume holding a copy. Ownership stays numeric: the daemons' archive download writes numeric uid and gid, the stream passes through untouched, and upload (without `copyUIDGID`) chowns to them, so Postgres's 999 stays 999. The helpers are created but never started, so their image's `tar` and `/etc/passwd` play no part. |
| Volumes used by running containers | inventory lists each volume's running users | Built | Containeria never stops the source's containers. A picked volume in use, or one a picked running container brings along, is marked In use, the view warns that a database may be copied mid-write, and Copy asks to confirm first. |
| `docker`, `docker compose`, `kubectl` on the PATH | bundled CLIs, Docker context set by Colima | Built | `scripts/fetch-tools.sh` bundles pinned Colima, Lima, krunkit, Docker CLI, Compose, Buildx, kubectl and Incus; Settings → Advanced links the missing ones (and `cx`) into /usr/local, never over the user's own. |
| Notice when another engine takes the Docker context | `currentContext` in `$DOCKER_CONFIG/config.json` (`~/.docker`), context `meta.json` | Built | While "Set Docker context" is on, every engine status refresh and every window focus reads the current context. When it isn't `colima-<profile>`, the sidebar and the menu bar popover name it, its endpoint and whether the endpoint answers (a connect to a `unix://` or `tcp://` host, within 0.5 s; `ssh://` can't be checked). "Use Containeria" writes only `currentContext`, keeping logins, credential helpers, other keys and the file's permissions. Starting the engine takes the context back by itself; nothing else does (ADR 4). `DOCKER_CONTEXT` or `DOCKER_HOST` set in a shell override the file there, and Containeria can't see them. |
| `cx` command-line tool | `crates/cli` | Built | `cx ps`, `start`, `stop`, `restart`, `logs -f`, `open`, `engine start\|stop\|status`, `data`. Works without the app. |
| Select many and delete at once: containers, images, volumes, networks | `useSelection`, `SelectionBar`, `useRemoveMany` | Built | Boxes on every row, ⌘-click and ⇧-click like Finder, ⌘⌫ to delete, Esc to let go. Images and volumes a container uses, built-in networks and networks with containers on them can't be selected; their box says why. Running containers can, and are stopped as they're deleted. |
| Times in the Mac's time zone and clock | `Intl` with the 12- or 24-hour setting read from `NSDateFormatter` | Built | Settings → General → Time, on by default; off shows UTC. Every time in the app goes through `lib/clock.ts`. |
| Closing the window leaves the Dock | `ActivationPolicy::Accessory` while no window is open | Built | Containeria stays in the menu bar; opening a window brings the Dock icon back. Quit ends it. |
| Native notifications | `tauri-plugin-notification` | Built | Crashes, failing health checks, low memory, and finished pulls, builds and Compose runs while in the background. Settings → General. |
| Reset the engine | `colima delete` | Built | Settings → Advanced, typed confirmation, optionally the machines VM too. |
| Collect diagnostics | Colima and Lima logs + our logs | Built | Help → Collect Diagnostics…: versions, engine and machine status, container names and states, engine settings, the tail of each VM's logs. No container settings, so no secrets. |

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
