#!/bin/sh
# Has Apple notarize a disk image and staples Apple's ticket to it, so it opens on any Mac
# without a warning, also one that is offline. The app inside is notarized by Tauri as it is
# built; this covers the image people download.
#   scripts/notarize.sh <file.dmg>
# Needs the three variables Tauri notarizes the app with: APPLE_ID, APPLE_PASSWORD (an
# app-specific password, not the account's) and APPLE_TEAM_ID.
set -eu

image="$1"
: "${APPLE_ID:?Set APPLE_ID, APPLE_PASSWORD and APPLE_TEAM_ID to notarize.}"
: "${APPLE_PASSWORD:?Set APPLE_ID, APPLE_PASSWORD and APPLE_TEAM_ID to notarize.}"
: "${APPLE_TEAM_ID:?Set APPLE_ID, APPLE_PASSWORD and APPLE_TEAM_ID to notarize.}"
account() {
  xcrun notarytool "$@" --apple-id "$APPLE_ID" --team-id "$APPLE_TEAM_ID" --password "$APPLE_PASSWORD"
}

report=$(mktemp)
trap 'rm -f "$report"' EXIT
account submit "$image" --wait --timeout 30m | tee "$report"
# The tool ends well whatever Apple decided; its last word is in what it printed.
if ! grep -q "status: Accepted" "$report"; then
  submission=$(sed -n 's/^ *id: //p' "$report" | head -1)
  echo "Apple didn't accept $(basename "$image"). Its reasons:" >&2
  account log "$submission" >&2 || true
  exit 1
fi

# The ticket is fetched from Apple, and from CI that connection drops now and then.
for attempt in 1 2 3 4 5; do
  if xcrun stapler staple "$image"; then break; fi
  if [ "$attempt" = 5 ]; then exit 1; fi
  sleep $((attempt * 10))
done
spctl --assess --type open --context context:primary-signature --verbose "$image"
