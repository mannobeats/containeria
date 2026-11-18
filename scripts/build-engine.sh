#!/bin/sh
# Builds Contena's engine into apps/desktop/src-tauri/resources/engine, where the app bundle
# takes it from and the dev app finds it:
#   contena-engine  the process that owns the VM and Docker's socket (crates/engine)
#   contena-vmm     the helper that runs the VM with Apple Virtualization (vmm/), signed
#                       with the virtualization entitlement, without which macOS refuses a VM
# The guest the VM boots is built by scripts/build-guest.sh into the same folder.
# Needs Xcode's command-line tools for Swift. Apple silicon only.
set -eu

root=$(cd "$(dirname "$0")/.." && pwd)
out="$root/apps/desktop/src-tauri/resources/engine"
mkdir -p "$out"

swift build --configuration release --package-path "$root/vmm"
install -m 0755 "$root/vmm/.build/release/contena-vmm" "$out/contena-vmm"

cargo build --manifest-path "$root/Cargo.toml" --locked --release -p contena-engine
install -m 0755 "$root/target/release/contena-engine" "$out/contena-engine"
# macOS refuses a VM to a helper that isn't signed with the virtualization entitlement.
sh "$root/scripts/sign-inside.sh"
echo "Engine ready in $out"
