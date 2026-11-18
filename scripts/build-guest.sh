#!/bin/sh
# Builds the Linux guest the engine boots into apps/desktop/src-tauri/resources/engine/guest:
#   Image          the kernel (guest/kernel.config on Linux, pinned in guest/Dockerfile)
#   rootfs.erofs   the read-only system image: Docker Engine, the agent, a small Alpine userland
#   kernel.config  the kernel's full configuration
# The agent is cross-compiled here; the rest builds in containers, so this needs a Docker engine
# (Containeria's own will do) and `docker buildx`. Apple silicon only.
set -eu

root=$(cd "$(dirname "$0")/.." && pwd)
out="$root/apps/desktop/src-tauri/resources/engine/guest"
target=aarch64-unknown-linux-musl

cargo build --manifest-path "$root/Cargo.toml" --locked --release --target "$target" \
  -p containeria-agent
# Only the agent goes to the build, not the folder of everything Cargo built beside it.
agent="$root/target/guest-agent"
mkdir -p "$out" "$agent"
cp "$root/target/$target/release/containeria-agent" "$agent/"
docker buildx build \
  --build-context "agent=$agent" \
  --output "type=local,dest=$out" \
  "$root/guest"
echo "Guest ready in $out"
