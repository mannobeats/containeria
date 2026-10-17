#!/bin/sh
# Downloads the command-line tools the app bundle ships, pinned and checked against their
# published SHA-256, into apps/desktop/src-tauri/resources/tools:
#   bin/          colima, limactl (+ lima), docker, incus, kubectl
#   share/lima/   Lima's guest agents and templates, found relative to bin/limactl
#   libexec/lima/ Lima's krunkit driver
#   cli-plugins/  docker-compose, docker-buildx
# Apple silicon only for now. Run it before `pnpm build`; the dev app falls back to Homebrew.
set -eu

COLIMA=0.10.3
LIMA=2.2.1
COMPOSE=5.6.0
BUILDX=0.38.0
INCUS=7.0.2
DOCKER=29.9.1
KUBECTL=1.37.1

root=$(cd "$(dirname "$0")/.." && pwd)
tools="$root/apps/desktop/src-tauri/resources/tools"
cache="${CONTAINERIA_TOOLS_CACHE:-$root/target/tools-cache}"
mkdir -p "$cache" "$tools/bin" "$tools/cli-plugins"

fetch() { # url sha256 file
  if [ ! -f "$cache/$3" ] || ! echo "$2  $cache/$3" | shasum -a 256 -c - >/dev/null 2>&1; then
    curl -sSfL -o "$cache/$3.part" "$1"
    mv "$cache/$3.part" "$cache/$3"
  fi
  echo "$2  $cache/$3" | shasum -a 256 -c - >/dev/null || {
    echo "checksum mismatch for $3" >&2
    exit 1
  }
}

fetch "https://github.com/abiosoft/colima/releases/download/v$COLIMA/colima-Darwin-arm64" \
  980ad8bf61a4ca370243f4cb41401a61276dcd2c2502bee7b9b86f9250169f34 colima
fetch "https://github.com/lima-vm/lima/releases/download/v$LIMA/lima-$LIMA-Darwin-arm64.tar.gz" \
  9e9eacce88f37e185c346bad73aa6136f738d8cdf8c3bb23cd42b071824bc66e lima.tar.gz
fetch "https://github.com/docker/compose/releases/download/v$COMPOSE/docker-compose-darwin-aarch64" \
  bd714a42b46e51757fc1121085b3096b9064e3f80d3ca5a991e33f44df4f43c9 docker-compose
fetch "https://github.com/docker/buildx/releases/download/v$BUILDX/buildx-v$BUILDX.darwin-arm64" \
  85989b895add5f119c1ccf8eada2f6892fc33ccf16bd8917638eae404ef26344 docker-buildx
fetch "https://github.com/lxc/incus/releases/download/v$INCUS/bin.macos.incus.aarch64" \
  12aa325c9437223bbdcb8da754e0aafdff948fc168f7537140460f20267762c8 incus
fetch "https://download.docker.com/mac/static/stable/aarch64/docker-$DOCKER.tgz" \
  7f2c1637313578046e7dd61153e4e4cd1188d83a1e4b71825ab914776c208460 docker.tgz
fetch "https://dl.k8s.io/release/v$KUBECTL/bin/darwin/arm64/kubectl" \
  fd65982c97ddad3106754b69ffa196d0e543aa591930ae52aed1adfb92f8c77f kubectl

install -m 0755 "$cache/colima" "$tools/bin/colima"
install -m 0755 "$cache/incus" "$tools/bin/incus"
install -m 0755 "$cache/kubectl" "$tools/bin/kubectl"
install -m 0755 "$cache/docker-compose" "$tools/cli-plugins/docker-compose"
install -m 0755 "$cache/docker-buildx" "$tools/cli-plugins/docker-buildx"
tar -xzf "$cache/docker.tgz" -C "$cache" docker/docker
install -m 0755 "$cache/docker/docker" "$tools/bin/docker"
rm -rf "$tools/share" "$tools/libexec"
# limactl finds its guest agents in ../share/lima and the krunkit driver in ../libexec/lima.
tar -xzf "$cache/lima.tar.gz" -C "$tools" ./bin/limactl ./bin/lima ./share/lima ./libexec/lima
echo "Tools ready in $tools"
