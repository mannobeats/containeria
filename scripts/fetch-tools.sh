#!/bin/sh
# Downloads the command-line tools the app bundle ships, pinned and checked against their
# published SHA-256, into apps/desktop/src-tauri/resources/tools:
#   bin/          docker, kubectl
#   cli-plugins/  docker-compose, docker-buildx
# The engine itself is built here, not downloaded: see scripts/build-engine.sh.
# Apple silicon only for now. Run it before `pnpm build`; the dev app falls back to Homebrew.
set -eu

COMPOSE=5.6.0
BUILDX=0.38.0
DOCKER=29.9.3
KUBECTL=1.37.1

root=$(cd "$(dirname "$0")/.." && pwd)
tools="$root/apps/desktop/src-tauri/resources/tools"
cache="${CONTENA_TOOLS_CACHE:-$root/target/tools-cache}"
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

fetch "https://github.com/docker/compose/releases/download/v$COMPOSE/docker-compose-darwin-aarch64" \
  bd714a42b46e51757fc1121085b3096b9064e3f80d3ca5a991e33f44df4f43c9 docker-compose
fetch "https://github.com/docker/buildx/releases/download/v$BUILDX/buildx-v$BUILDX.darwin-arm64" \
  85989b895add5f119c1ccf8eada2f6892fc33ccf16bd8917638eae404ef26344 docker-buildx
fetch "https://download.docker.com/mac/static/stable/aarch64/docker-$DOCKER.tgz" \
  79145e169bca0b9571d02de8e1cd311a36e0e8fdb4599b6661a87b1bb3afbe13 docker.tgz
fetch "https://dl.k8s.io/release/v$KUBECTL/bin/darwin/arm64/kubectl" \
  fd65982c97ddad3106754b69ffa196d0e543aa591930ae52aed1adfb92f8c77f kubectl

install -m 0755 "$cache/kubectl" "$tools/bin/kubectl"
install -m 0755 "$cache/docker-compose" "$tools/cli-plugins/docker-compose"
install -m 0755 "$cache/docker-buildx" "$tools/cli-plugins/docker-buildx"
tar -xzf "$cache/docker.tgz" -C "$cache" docker/docker
install -m 0755 "$cache/docker/docker" "$tools/bin/docker"
echo "Tools ready in $tools"
