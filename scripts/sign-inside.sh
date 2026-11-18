#!/bin/sh
# Signs the programs the app carries inside it: the engine, the VM helper and the bundled tools,
# all under apps/desktop/src-tauri/resources. Tauri signs the app around them and leaves these
# as they came, and Apple notarizes an app only when every program in it has the same
# developer's signature. Run it after the last of them is in place and before the app is built.
#   APPLE_SIGNING_IDENTITY   a "Developer ID Application: …" identity, the one Tauri signs the
#                            app with. Unset, the signature is ad-hoc: good on the Mac that
#                            made it, and one macOS asks about on any other.
set -eu

root=$(cd "$(dirname "$0")/.." && pwd)
resources="$root/apps/desktop/src-tauri/resources"
identity="${APPLE_SIGNING_IDENTITY:--}"
# Notarizing needs Apple's timestamp on a signature, and an ad-hoc signature can't carry one.
sign() {
  if [ "$identity" = "-" ]; then
    codesign --force --sign - --options runtime "$@"
  else
    codesign --force --sign "$identity" --options runtime --timestamp "$@"
  fi
}

for program in "$resources"/tools/bin/* "$resources"/tools/cli-plugins/* \
  "$resources/engine/contena-engine"; do
  if [ -f "$program" ]; then sign "$program"; fi
done
# The one program that may run a VM, which macOS allows by this entitlement.
sign --entitlements "$root/vmm/vmm.entitlements" "$resources/engine/contena-vmm"
