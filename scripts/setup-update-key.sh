#!/bin/bash
# Makes the key Contena's updates are signed with, once, and gives its private half to this
# repository on GitHub for the Release workflow. An installed Contena only accepts an update
# signed with it: lose the key and nobody who has the app can be sent another update.
#   ~/.tauri/contena.key       the private key, encrypted with a password
#   ~/.tauri/contena.key.pub   the public key, which apps/desktop/src-tauri/tauri.conf.json carries
# The password is kept in the login keychain as "Contena update key". Back both up.
# Run again, it sends the same key to GitHub and makes no new one.
set -euo pipefail
cd "$(dirname "$0")/.."
repository=$(gh repo view --json nameWithOwner --jq .nameWithOwner)
key="$HOME/.tauri/contena.key"
keychain_item="Contena update key"

if [ ! -f "$key" ]; then
  password=$(openssl rand -hex 24)
  # Run directly: pnpm prints the command it runs, and the password is on it.
  apps/desktop/node_modules/.bin/tauri signer generate --ci --write-keys "$key" \
    --password "$password" >/dev/null 2>&1
  security add-generic-password -U -a contena -s "$keychain_item" -w "$password"
  echo "Made a new update key at $key."
fi
password=$(security find-generic-password -a contena -s "$keychain_item" -w)

gh secret set TAURI_SIGNING_PRIVATE_KEY --repo "$repository" < "$key"
printf %s "$password" | gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD --repo "$repository"

echo "The repository has the key. The public half, for plugins.updater.pubkey in tauri.conf.json:"
cat "$key.pub"
echo
