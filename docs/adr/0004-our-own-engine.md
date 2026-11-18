# 4. Our own engine

Date: 2026-11-14. Status: accepted. Supersedes [1. Colima is the engine](0001-colima-is-the-engine.md).
Two of its consequences are changed by [5. The guest's kernel carries one patch](0005-one-kernel-patch.md).

## Context

With Colima, a fresh engine took 1.1 GB of disk plus a 320 MB image download, 39 s to restart,
and memory that only went up: 915 MB idle, 8 GB after one container used 3 GB and exited, never
returned until a restart. Deleted images stayed on the Mac until a weekly trim. Linux machines
needed a second VM. None of it could be changed from outside Colima and Lima.

## Decision

Contena runs its own engine. Docker itself stays: the guest runs the unmodified Docker Engine
(dockerd, containerd, runc, BuildKit), so every `docker` feature behaves as it does everywhere.

- **VM**: Apple Virtualization, driven by a small Swift helper (`vmm/`). Swift because the
  framework is Swift's own API and Rust would need `unsafe` for it, which this workspace forbids;
  a separate process because only it then carries the virtualization entitlement.
- **Guest** (`guest/`): a Linux LTS kernel built from `allnoconfig` plus what Docker, Kubernetes
  and systemd in a container need, no modules; a read-only EROFS system image with Docker's
  static release and a small Alpine userland; a Rust agent (`crates/agent`) as process 1.
- **Engine** (`crates/engine`): one process on the Mac that owns the VM, Docker's socket and
  published ports. The VM turns off when nothing runs in it and boots again on the next
  connection to the socket.
- **Kubernetes**: k3s run by the agent, using Docker as its runtime.
- **Linux machines**: containers in the same engine, with the distribution's init as process 1.
  No second VM, and no Incus.

## Consequences

- Measured on an M1 Max, macOS 27.2: 1.1 to 1.4 s from off to Docker answering; 483 MB with
  Docker idle; about 5 MB while asleep; a deleted image's space back on the Mac at once.
- Apple's balloon keeps the guest from growing but showed no memory returning to macOS while
  the Mac had memory to spare. Memory a workload touched comes back when the VM sleeps, which is
  why sleeping is on by default and booting had to be fast.
- We maintain a kernel configuration and must ship a new guest for kernel and Docker security
  fixes. The kernel is GPL-2.0; it is built unpatched from the release named in
  `guest/Dockerfile`.
- Building the guest needs a Docker engine. Contena's own builds it.
- Not carried over from Colima: file-watch events for bind mounts, SSH agent forwarding, reaching
  containers by IP from the Mac, full VMs as Linux machines, and Intel Macs.
- The helper must keep each VM connection alive until the engine is done with it, and the engine
  must let the guest power itself off. Both were bugs first; `crates/engine/tests/engine.rs`
  keeps them fixed.
