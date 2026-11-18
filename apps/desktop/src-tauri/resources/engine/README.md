# The engine

Built here, not downloaded. Only this README is committed.

| File | What | Built by |
|---|---|---|
| `containeria-engine` | The process that owns the VM, Docker's socket and published ports (`crates/engine`). | `scripts/build-engine.sh` |
| `containeria-vmm` | The helper that runs the VM with Apple Virtualization (`vmm/`), signed with the virtualization entitlement. | `scripts/build-engine.sh` |
| `guest/Image` | The guest's Linux kernel (`guest/kernel.config`). GPL-2.0; its source is the release named in `guest/Dockerfile`, unpatched. | `scripts/build-guest.sh` |
| `guest/rootfs.erofs` | The guest's read-only system: Docker Engine, the agent (`crates/agent`) and a small Alpine userland. | `scripts/build-guest.sh` |
| `guest/kernel.config` | The kernel's full configuration. | `scripts/build-guest.sh` |

`scripts/build-guest.sh` needs a Docker engine; Containeria's own will do.
