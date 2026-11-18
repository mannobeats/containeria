#!/bin/sh
# Prints the file an installed Contena reads to learn of a newer version: the version, and for
# Apple silicon where its signed archive is and the signature the app checks it against.
#   scripts/update-manifest.sh <tag> <Contena.app.tar.gz> > latest.json
# The archive's signature is read from the file beside it that Tauri writes, <archive>.sig.
# Needs GITHUB_REPOSITORY (owner/name), which GitHub's runners set.
set -eu

tag="$1"
archive="$2"
repository="${GITHUB_REPOSITORY:?Set GITHUB_REPOSITORY to owner/name.}"
printf '{"version":"%s","pub_date":"%s","platforms":{"darwin-aarch64":{"signature":"%s","url":"https://github.com/%s/releases/download/%s/%s"}}}\n' \
  "${tag#v}" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(cat "$archive.sig")" "$repository" "$tag" \
  "$(basename "$archive")"
