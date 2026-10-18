# Bundled tools

`scripts/fetch-tools.sh` fills this folder with the pinned, checksum-verified command-line tools the
app ships: Colima and Lima (the engine), krunkit (the libkrun VM, for the `krunkit` VM type), the
Docker CLI with Compose and Buildx, kubectl and the Incus client. Only this README is committed.
Without the tools, the app uses the copies Homebrew installed.

| Tool | Where | License | Source |
|---|---|---|---|
| Colima | `bin/colima` | MIT | github.com/abiosoft/colima |
| Lima | `bin/limactl`, `bin/lima`, `share/lima`, `libexec/lima` | Apache-2.0 | github.com/lima-vm/lima |
| krunkit | `bin/krunkit` | Apache-2.0 | github.com/containers/krunkit |
| libkrun | `lib/libkrun.dylib` | Apache-2.0 | github.com/containers/libkrun |
| virglrenderer | `lib/libvirglrenderer.1.dylib` | MIT | gitlab.freedesktop.org/virgl/virglrenderer |
| libepoxy | `lib/libepoxy.0.dylib` | MIT | github.com/anholt/libepoxy |
| MoltenVK | `lib/libMoltenVK.dylib` | Apache-2.0 | github.com/KhronosGroup/MoltenVK |
| EDK2 firmware | `share/krunkit/KRUN_EFI.silent.fd` | BSD-2-Clause-Patent | github.com/tianocore/edk2, built by krunkit |
| Docker CLI | `bin/docker` | Apache-2.0 | github.com/docker/cli |
| Docker Compose | `cli-plugins/docker-compose` | Apache-2.0 | github.com/docker/compose |
| Docker Buildx | `cli-plugins/docker-buildx` | Apache-2.0 | github.com/docker/buildx |
| kubectl | `bin/kubectl` | Apache-2.0 | github.com/kubernetes/kubernetes |
| Incus client | `bin/incus` | Apache-2.0 | github.com/lxc/incus |

krunkit comes from its `krunkit-podman-unsigned` release, built for `/opt/podman`. The script
points its library path at `lib/` and signs it ad hoc with the `com.apple.security.hypervisor`
entitlement; Lima runs it from the `PATH` and krunkit loads its firmware from `../share/krunkit`.
libkrunfw is not shipped: krunkit boots the VM's own kernel through the EFI firmware.
