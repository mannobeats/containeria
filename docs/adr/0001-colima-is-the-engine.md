# 1. Colima is the engine

Date: 2026-10-17. Status: accepted.

## Context

Containeria replaces Docker Desktop and OrbStack. It needs a Linux VM on macOS with Docker,
Kubernetes and system containers, low idle memory and fast file sharing. Writing a VM manager is
years of work; OrbStack's is closed source.

## Decision

Bundle Colima (MIT) and Lima (Apache-2.0) unchanged and pinned, and drive them through the Colima
CLI from Rust. Containeria keeps its own `COLIMA_HOME` and two profiles: `containeria` (Docker and
k3s) and `containeria-machines` (Incus). Everything Colima lacks is Containeria's own Rust code:
domains, HTTPS, the data browser, file browsing, migration, the memory ledger.

## Consequences

- Memory goes back to macOS only with the `krunkit` VM type; Apple Virtualization holds it until a
  restart (docs/features.md, decision 1). If this matters more than Rosetta, the long-term path is
  Containeria's own VM layer on libkrun, in Rust.
- Colima's CLI output is an interface Containeria parses; `crates/engine` tests it with real samples
  and pins the version.
