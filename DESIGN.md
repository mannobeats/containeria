# Containeria design system

Developers on macOS who run local containers, databases, Kubernetes and Linux machines, and open
the app dozens of times a day for a few seconds each. Flavor: technical, native macOS. Built with
art-director.

## Direction

```
App: Containeria, for developers on macOS, doing local container, database, Kubernetes and Linux
  machine work, dozens of times a day, mostly in short visits from the menu bar.
  They open it asking: is my stack up, what is eating my Mac, and where is the thing I need
  right now (a log line, a shell, a URL, a table row)?
Key object: the container, grouped by its Compose project. States: running, starting,
  restarting, paused, unhealthy, exited cleanly, crashed (non-zero exit).
Needs attention: crashed and unhealthy containers (red), memory pressure (amber). Nothing else
  is colored.
Actions: primary "Run container"; frequent start/stop, logs, terminal, open URL, copy domain,
  open database; rare inspect, rename, commit, export, recreate; destructive delete container,
  delete volume, prune images, drop table.
Density: standard-dense (13px base, 36px rows), because it is a developer tool used in quick
  glances and long debugging sessions alike.
Shell: sidebar + content + in-place detail, because there are many sections (Docker,
  Kubernetes, Linux, Data) and the user jumps between them constantly.
Obvious version: Docker Desktop. A sidebar of colored icons, four stat cards (CPU, memory,
  containers, images) with green % pills, a blue gradient area chart, a flat table of
  containers with a status badge on every row, "View all" on every panel.
Three directions, each from one thing in the user's world:
  A. The memory ledger: the first screen draws the engine's memory as one strip split by
     Compose project, with the part handed back to macOS shown as its own hatched segment,
     above the container list grouped by project / neutral cool grays + system accent / Geist.
  B. The cargo manifest: each Compose project is a bay, rows read like a manifest, ports drawn
     as routes from container to *.containeria.local domain / warm grays + signal orange / Geist.
  C. The process tree: Activity Monitor meets a terminal, keyboard-only list of every process
     across containers and machines / near-black + green / Geist Mono everywhere.
Pick: A, because people leave Docker Desktop over memory they cannot see; showing where every
  megabyte goes, and what came back, answers their first question before they ask it.
Signature: the memory ledger. A live strip of the engine's RAM, one segment per Compose
  project, sized by real usage, plus a hatched "returned to macOS" segment. Hovering a segment
  lights up that project's rows. The same strip lives in the containers header, the menu bar
  popover and Activity. Built with live data bars (segment widths animate on transform as
  usage changes).
Palette: barely cool neutrals (tint .005 toward 255). Brand = the macOS system accent, Apple
  blue by default (hue 255), because native Mac apps follow the user's accent and the setting
  lets them change it. Red means crashed or destructive, amber memory pressure or unhealthy,
  green only the running glyph. Six ledger hues at equal lightness for projects.
Type: Geist for UI, Geist Mono for IDs, ports, image digests, logs and SQL, because Geist was
  drawn for developer interfaces and its mono sibling keeps logs and UI in one voice.
  App scale 12 / 13 / 14 / 16 / 20 / 24px.
First screen: 10 of 14 containers are running and use 4.8 GB of the engine’s 8 GB, analytics uses
  most of it, 2.4 GB went back to macOS, and payments-mock crashed 4 minutes ago.
```

Data browser signature: the pending-changes bar. Every edit in the grid is staged, shown as a
diff on the cell, counted in a bar at the bottom, and only written on Commit (⌘S).

## Tokens

Source: `design/css/tokens.css`. Components never use raw colors, sizes, fonts or shadows.
Knobs: brand hue 255 (macOS system accent, user-changeable), gray tint .005 toward 255,
font Geist + Geist Mono (developer UI, one voice for logs), radius 6 / 8 / 12, lead mode
follows the system (dark designed first, light designed separately).

## Components

Where: `design/css/base.css` (prototype). Buttons: ghost, default, soft, strong, brand,
danger; sizes sm (24px), md (28px), lg (32px).

## Icons and logos

Three sources, each with one job:
- **Containeria icons** (`design/js/icons.js`, `cxIcon`) for Containeria's own objects: container,
  image, volume, network, kube, pod, machine, data, domain, activity, settings, compose, layer.
  24px grid, 1.5px stroke, round joins, one soft fill (`.f`, the body) and one accent (`.a`, the
  live part). The accent turns brand-colored only when the item is active or shown large.
- **Real brand logos** for anything that has one: databases, languages, runtimes, servers,
  distros. Devicon originals (MIT) first, Simple Icons (CC0) where Devicon has none. Never redrawn,
  never recolored except a light variant of near-black marks for dark mode. They sit on a neutral
  chip (`.tile`), never a colored one. `logoKey()` maps an image, connection or distro to its logo.
- **Tabler** (`tabler-icons-300`, 1.5px) for generic UI actions: search, play, stop, copy, filter.

No two-letter monograms. An object without a known logo gets the Containeria icon for its kind.

## Rules

art-director's hard bans hold. No dots inside chips; state is shown with the row's image
tile, a glyph and words. Approved exceptions: none yet.

## Done means

Looked at in a browser at 1440 and 1024 wide, light and dark. Minimum window width 960px
(desktop app, no phone layout).
