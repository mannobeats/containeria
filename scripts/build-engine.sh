#!/bin/sh
# Builds Containeria's engine into apps/desktop/src-tauri/resources/engine, where the app bundle
# takes it from and the dev app finds it:
#   containeria-engine  the process that owns the VM and Docker's socket (crates/engine)
#   containeria-vmm     the helper that runs the VM with Apple Virtualization (vmm/), signed
#                       with the virtualization entitlement, without which macOS refuses a VM
# The guest the VM boots is built by scripts/build-guest.sh into the same folder.
# Needs Xcode's command-line tools for Swift. Apple silicon only.
set -eu

root=$(cd "$(dirname "$0")/.." && pwd)
out="$root/apps/desktop/src-tauri/resources/engine"
identity="${CONTAINERIA_SIGNING_IDENTITY:--}"
mkdir -p "$out"

swift build --configuration release --package-path "$root/vmm"
install -m 0755 "$root/vmm/.build/release/containeria-vmm" "$out/containeria-vmm"
codesign --force --sign "$identity" --entitlements "$root/vmm/vmm.entitlements" \
  "$out/containeria-vmm"

cargo build --manifest-path "$root/Cargo.toml" --locked --release -p containeria-engine
install -m 0755 "$root/target/release/containeria-engine" "$out/containeria-engine"
codesign --force --sign "$identity" "$out/containeria-engine"
echo "Engine ready in $out"
