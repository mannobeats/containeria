# Containeria feature map

Every feature in the design prototype (`design/`), mapped to the part of the engine that makes it
work. The engine is Containeria's own ([ADR 4](adr/0004-our-own-engine.md)); the figures here were
measured on an M1 Max with macOS 27.2 in November 2026.

## How the engine is built

| Layer | What it is | License |
|---|---|---|
| App | Tauri 2, Rust core, React UI | Apache-2.0 (ours) |
| Our Rust layer | Docker API client (`bollard`), domain DNS and HTTPS proxy, file and volume browsing, migration, stats, database drivers, Linux machines, `cx` CLI | ours |
| Engine | `containeria-engine`: owns the VM, Docker's socket on the Mac, published ports, the VM's memory and its sleep (`crates/engine`) | ours |
| VM helper | `containeria-vmm`: runs the VM with Apple Virtualization (`vmm/`, Swift) | ours |
| Guest | A Linux 6.18 LTS kernel with our configuration, an Alpine userland, and our agent as process 1 (`guest/`, `crates/agent`) | GPL-2.0 (kernel), ours |
| Inside the guest | Docker Engine (moby), containerd, BuildKit, runc, unmodified; k3s when Kubernetes is on | Apache-2.0 |

There is one VM. Containers, the Kubernetes cluster and Linux machines all run in it.

## Legend

- **Engine**: Containeria's engine or its guest does it.
- **Docker API**: the Docker Engine API does it; we call it through `bollard`.
- **We build**: our own Rust code on top of the engine.
- **Limited**: works, with a limit written next to it.
- **Not yet**: the prototype shows it and nothing makes it work so far.

## Engine

| Feature | Source | Status | Notes |
|---|---|---|---|
| Start, stop, restart the engine | the engine process, started by the app or `cx engine start` | Engine | 1.1 to 1.4 s from off to Docker answering. Stopping lets Docker stop its containers, then the guest writes its disk out and powers itself off. |
| Sleep when nothing runs | the engine turns the VM off after `idleSeconds` (60) with no container, build, pod or machine running and nobody talking to Docker | Engine | On by default. The next connection to Docker's socket boots the VM again, so `docker ps` on a sleeping engine just takes a second longer. Asleep, the engine process uses about 5 MB. A request still waiting for its answer keeps the VM awake however long it takes. |
| The app doesn't keep the VM awake | a second Docker socket for watchers, `docker-watch.sock` | Engine | The app's lists, charts and event relay use it: it answers only while the VM runs and never counts as use. The app holds the VM awake only while one of its windows shows. |
| CPU and memory limits | `engine.json` | Engine | Applied at the VM's next start. Memory is a ceiling: the VM is allowed what its work holds plus 768 MB, grown at once when it asks and shrunk 256 MB at a time. |
| Memory back to macOS | the guest is kept to what its work holds plus 768 MB; what it gives up, Apple's VM marks as memory macOS may take | Limited | macOS takes that memory when it gets to it, not when it is given, and until then Activity Monitor still counts it against the VM. Measured after a container used 3 GB and ended, with the guest back at 0.8 GB: the VM showed 3.5 GB, of which 1.0 GB was in use and 2.5 GB was macOS's to take without swapping. In some runs macOS took it as fast as it was given; in others not even when it needed 3 GB elsewhere. Nothing the guest did differently changed that: giving memory up in whole Mac pages, lowest address first, or in 1 MB blocks. All of it is back when the VM sleeps or stops. With Docker idle the VM shows 500 MB. |
| Disk size | a sparse file, `vm/data.img` | Limited | Can grow, never shrink. It holds only what is stored: the guest mounts it with `discard`, so deleting an image gives its space back to the Mac at once. |
| Data location | `vm/` moved, a link left in its place | Built | Settings → Storage moves the data disk to another folder or drive (APFS or Mac OS Extended) and back. Copies only the data in the sparse disk, swaps the link in one rename, and starts the engine again if it ran. |
| Rosetta for amd64 images | Apple's Rosetta share, registered with `binfmt_misc` by the agent | Engine | Apple silicon only, when Rosetta is installed. |
| Files shared with your Mac | virtiofs shares of `/Users`, `/Volumes` and `/private`, at the same paths | Engine | A bind mount means the same folder on both sides. `/tmp` and `/var/folders`, where macOS keeps temporary files, are there too. |
| Speed of shared folders | Apple's virtiofs, as it is | Limited | Every operation on a shared file is done on the Mac and costs about 0.1 ms on top. Reading and writing in large pieces is as fast as the VM's own disk (0.9 to 1.8 GB/s measured). Many small operations are slower: making 5,000 small files took 4.9 s against 1.3 s on a volume, reading them 1.1 s against 0.1 s. A dependency folder with tens of thousands of files, such as `node_modules`, is better kept in a volume. |
| File-watch events (hot reload) | the VM helper watches the folders running containers have mounted (FSEvents); the guest's kernel raises the inotify events (`guest/patches`) | Engine | Saves in place and by rename, new and deleted files and folders, permissions and `touch`. Measured with Node's chokidar and 300 saves on the Mac: all 300 seen, arriving within 20 ms of each other. A change a container makes itself is raised twice, once by Linux and once on its way back from the Mac. Changes under `~/Library` aren't reported. |
| A saved file is the new file at once | the same reports end the guest's trust in what it cached | Engine | Apple's file sharing lets the guest believe what it last saw for up to a second: a file saved on the Mac kept its old size in a container, and one saved by renaming a new file over it, as vim and JetBrains do, couldn't be opened. Now the next look asks the Mac, whether or not anything watches. |
| SSH agent forwarding | the guest's `/run/host-services/ssh-auth.sock` is the Mac's SSH agent | Engine | Mount it and set `SSH_AUTH_SOCK`, as with Docker Desktop: `-v /run/host-services/ssh-auth.sock:/ssh-agent -e SSH_AUTH_SOCK=/ssh-agent`. Any user in the container can use it. The agent is the one of whoever started the engine (`SSH_AUTH_SOCK` at that moment). Linux machines have it without asking. `docker build --ssh` needs none of this: the `docker` command hands the agent to the build itself. |
| `host.docker.internal` | the guest answers DNS for it and carries what is sent there to the Mac | Engine | Resolves in every container with nothing added, as `host.containeria.internal` does, and `host-gateway` means the same address. TCP reaches servers on the Mac's own `localhost`, also ones that listen for nobody else; a port nothing listens on is refused at once. UDP reaches what listens on every address of the Mac. IPv4 only. |
| The guest's clock | set from the Mac at start, and again whenever it is more than a second off | Engine | It stands still while the Mac sleeps. |
| Docker daemon settings (mirrors, insecure registries) | `engine.json` → the guest's `daemon.json` | Engine | |
| Make `docker` use Containeria | `docker context create` and `use`, when the app starts the engine | Built | The context is named `containeria`. Settings → Engine turns it off. |
| What was written survives a stop | the guest powers itself off after writing its disk out | Engine | The engine cuts the power only when the guest stays on 30 s after its agent ended. |

## Containers

| Feature | Source | Status | Notes |
|---|---|---|---|
| List, start, stop, restart, pause, delete | containers API | Docker API | |
| Live CPU, memory, network, disk stats | `/containers/{id}/stats` stream | Docker API | |
| Live state changes without polling | `/events` stream | Docker API | |
| Group by Compose project | `com.docker.compose.*` labels | Docker API | |
| Deploy, edit, rebuild, pull, remove a project | Docker Compose CLI | Built | Paste YAML, open or drop a `compose.yaml`. Compose is Apache-2.0; the app looks for `cli-plugins/docker-compose` in its bundle, then the Docker CLI plugin, then Homebrew. Pasted projects live in `~/.containeria/compose/<name>`. |
| Logs with follow, filter, levels | `/containers/{id}/logs` | Docker API | Levels parsed by us. |
| Terminal into a container | exec API with TTY | Docker API | |
| Debug shell for minimal images | sidecar container sharing PID and network namespaces | We build | Same idea as `docker debug`. |
| Files tab: browse, download, upload | `/containers/{id}/archive` GET and PUT | Docker API | |
| Open container files in Finder | | Not yet | The prototype shows the button. |
| Inspect JSON | `/containers/{id}/json` | Docker API | |
| Rename, recreate, commit, export | containers API | Built | Recreate keeps name, ports, networks and anonymous volumes; the old container goes only once the new one exists. |
| Published ports open on the Mac | the agent stands in for Docker's port proxy and has the engine listen on the Mac before the container starts | Engine | TCP and UDP, IPv4 and IPv6, on the address the container asked for. A port the Mac already uses fails the container's start with "Port 8080 is already in use on your Mac." macOS lets apps listen below 1024 only on every address. |
| Port conflict detection and the "use 5433" fix | check host ports, recreate with a new mapping | We build | |
| Run container sheet | create + start API, Docker Hub search API | Docker API | |

## Domains and HTTPS

| Feature | Source | Status | Notes |
|---|---|---|---|
| `name.project.containeria.local` for every container | our DNS server (127.0.0.1:15353) + `/etc/resolver/containeria.local` | Built | `crates/net`. Admin password once, through a macOS prompt the user starts. |
| Reaching containers with no published port | the proxy connects to the container's own address through the engine (`run/inside.sock`) | Built | A published port is used when there is one; else the port the image exposes, a usual web port first. A custom route reaches any port. A container that exposes nothing shows "No port to send to". HTTP and HTTPS only: other protocols need a published port. |
| Local HTTPS with a trusted certificate | our local CA (rcgen), trusted in the login keychain once | Built | Leaf certificates issued per host on first use, valid 397 days (Apple's limit is 825). Proxy on 80/443 when free, else 7080/7443. |
| Custom routes like `shop.test` | same proxy | Built | Saved in `~/.containeria/net/settings.json`. |
| Direct container IP from the Mac | | Not yet | Needs a route on the Mac, which only root can add: a helper installed with the admin password. |
| `*.k8s.containeria.local` for services | proxy reads k3s services | Built | `<service>.<namespace>.k8s.containeria.local` for LoadBalancer and NodePort services, through the port the engine publishes on the Mac. ClusterIP-only services aren't reachable from the Mac. |

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
| Turn on and off, pick version | the agent fetches the k3s release, checks it against the release's SHA-256 and runs it | Engine | First start 17 s including the download, 4 s after an engine restart. Turning it off stops its pods; its objects are kept. While it is on, the VM doesn't sleep. |
| `kubectl` works | the engine writes a `containeria` context into `~/.kube/config` (or the first file in `$KUBECONFIG`) and publishes the API on `127.0.0.1:6443` | Engine | Turning Kubernetes on selects the context. Other clusters in the file stay as they are. If 6443 is taken, the next free port is used. |
| Pods, deployments, services, ingress, config | Kubernetes API via `kube-rs` | We build | |
| Pod logs, terminal, events, YAML | Kubernetes API | Built | The terminal is `kubectl exec -it` through kube-rs, with a container picker. |
| Apply YAML, scale, restart, port-forward, namespaces | Kubernetes API | Built | Deployments edit their YAML in place; New Namespace…; Copy kubeconfig Path. |
| Images built locally usable in k3s | k3s uses Docker as its runtime | Engine | No registry needed; pods show up in `docker ps`. |
| LoadBalancer and NodePort services on localhost | the agent watches the cluster's services and has the engine publish their ports | Engine | On `127.0.0.1`. |
| Reset cluster | stop k3s, delete what it stored, start it again | Engine | 7 s. |

## Linux machines

A machine is a container in the engine made from the distribution's own image, with the
distribution's init system as process 1, your Mac user inside and your home folder at the same
path. `crates/machines` makes and keeps them through the Docker API.

| Feature | Source | Status | Notes |
|---|---|---|---|
| Ubuntu, Debian, Fedora, Alpine, openSUSE, Rocky, Kali | the distribution's image on Docker Hub, set up once per release with its init system and sudo | Built | The first machine of a release takes about half a minute; later ones start in a second. systemd distributions run systemd; Alpine runs OpenRC. Arch and NixOS have no official image for Apple silicon. |
| Full VMs instead of containers | | Not yet | The engine has no nested virtualization. |
| Your user, with sudo | a user with your Mac name and number, and no password for sudo | Built | Files in the shared home folder belong to the same person on both sides. |
| Your SSH keys | the Mac's SSH agent, mounted and named in every login shell | Built | `git` and `ssh` in a machine use the keys the Mac's agent holds. |
| Mac home folder inside the machine | a bind mount at the same path | Built | Chosen when the machine is made. |
| Terminal and files | Docker exec and the archive API, as for any container | Built | The terminal is a login shell as your user. |
| Machines come back with the engine | restart policy `unless-stopped` | Built | A running machine keeps the VM awake. |
| Open in Terminal App, Copy Shell Command | `docker exec -it … su - you` with the bundled Docker CLI | Built | Opens a `.command` file from `~/.containeria/terminal`, so macOS asks for no Automation permission. |
| Snapshots: take, restore, delete | `docker commit` to an image named after the machine and the snapshot | Built | A running machine pauses for the moment a snapshot takes (0.3 s for a fresh Ubuntu). Restoring keeps the machine as it was until the restored one exists. |
| Clone | commit, then a new machine from that image | Built | The copy is stopped. |
| Export and import | the container's filesystem as a tar, in and out | Built | Without snapshots. The machine records its distribution and user in `/etc/containeria-machine.json`, so an import knows what it is. |
| `ssh name@containeria` | | Not yet | |
| amd64 machines | | Not yet | |
| Engine shell | privileged busybox entering PID 1 with `nsenter` | Built | Engine → Open Engine Shell: root in the VM. |

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
| Memory shown in the menu bar | Docker stats | We build | |
| Memory ledger (per project) | Docker stats + k3s metrics | We build | |
| Activity charts | same sources, sampled | We build | |
| ⌘K command palette, shortcuts | our UI | We build | |
| Settings | `~/.containeria/engine.json` + our own settings | We build | |
| Launch at login | Tauri autostart plugin, a LaunchAgent passing `--at-login` | Built | On once first launch is finished or skipped. A login launch stays in the menu bar without the window. |
| Engine starts with the app | `engine::start_with_app` when the engine is stopped | Built | On by default (General settings), so after a Mac restart the engine and containers with a restart policy come back. A never-created or broken engine waits for the user. |
| Auto-update | Tauri updater | We build | Needs Developer ID signing first. |
| First launch and import from Docker Desktop or OrbStack | `docker save`/`load`, volume tar copy, recreate from inspect | Built | Images, named volumes with their files, and containers with ports, settings, networks and Compose labels. Also File → Import. The source only gets short-lived helper containers to read volumes. |
| `docker`, `docker compose`, `kubectl` on the PATH | bundled CLIs | Built | `scripts/fetch-tools.sh` bundles the pinned Docker CLI, Compose, Buildx and kubectl; Settings → Advanced links the missing ones (and `cx`) into /usr/local, never over the user's own. |
| `cx` command-line tool | `crates/cli` | Built | `cx ps`, `start`, `stop`, `restart`, `logs -f`, `open`, `engine start\|stop\|status`, `data`. Works without the app. |
| Select many and delete at once: containers, images, volumes, networks | `useSelection`, `SelectionBar`, `useRemoveMany` | Built | Boxes on every row, ⌘-click and ⇧-click like Finder, ⌘⌫ to delete, Esc to let go. Images and volumes a container uses, built-in networks and networks with containers on them can't be selected; their box says why. Running containers can, and are stopped as they're deleted. |
| Times in the Mac's time zone and clock | `Intl` with the 12- or 24-hour setting read from `NSDateFormatter` | Built | Settings → General → Time, on by default; off shows UTC. Every time in the app goes through `lib/clock.ts`. |
| Closing the window leaves the Dock | `ActivationPolicy::Accessory` while no window is open | Built | Containeria stays in the menu bar; opening a window brings the Dock icon back. Quit ends it. |
| Native notifications | `tauri-plugin-notification` | Built | Crashes, failing health checks, low memory, and finished pulls, builds and Compose runs while in the background. Settings → General. |
| Reset the engine | stop it and delete its data disk | Built | Settings → Advanced, typed confirmation. Linux machines live on the same disk and go with it. |
| Collect diagnostics | the engine's log and the guest's console | Built | Help → Collect Diagnostics…: versions, engine status, container names and states, engine settings, the tail of both logs. No container settings, so no secrets. |

## Decisions this map forces

1. **Memory comes back when the VM sleeps.** While it runs, the engine keeps the guest close to
   what its work holds, so idle cost stays low and file cache can't fill the ceiling. What a
   workload did touch is returned by turning the VM off, which is why that is automatic and why
   booting takes a second.
2. **One VM.** Containers, Kubernetes and Linux machines share it.
3. **Domains, HTTPS and the data browser are ours.** They are where Containeria stands apart.
4. **Every number in the app or these docs is measured**, on a named Mac and macOS.
