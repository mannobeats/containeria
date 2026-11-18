#!/bin/bash
# Gives this repository on GitHub what its Release workflow signs and notarizes with. Run it
# yourself, once, and again when the certificate or a password changes. Passwords are typed at
# hidden prompts; nothing is printed or kept on this Mac.
#   scripts/setup-release-secrets.sh ~/Desktop/DeveloperID.p12
# Needs the `gh` command signed in to an account that may change the repository's settings, and
# a "Developer ID Application" certificate in the login keychain.
set -euo pipefail
cd "$(dirname "$0")/.."
repository=$(gh repo view --json nameWithOwner --jq .nameWithOwner)

identity=$(security find-identity -v -p codesigning |
  sed -n 's/.*"\(Developer ID Application: .*\)"$/\1/p' | head -1)
if [ -z "$identity" ]; then
  echo "There is no Developer ID Application certificate in the login keychain." >&2
  echo "Make one in Xcode: Settings > Accounts > Manage Certificates > + > Developer ID Application." >&2
  exit 1
fi
team=$(sed -E 's/.*\(([A-Z0-9]{10})\)$/\1/' <<<"$identity")

certificate="${1:-}"
if [ -z "$certificate" ] || [ ! -f "$certificate" ]; then
  cat <<EOF2
First export the certificate, with its private key, as a .p12 file:
  1. Keychain Access opens now. Pick "login" in the sidebar, then "My Certificates".
  2. Right-click "$identity" and choose Export.
  3. Save it as DeveloperID.p12 on the Desktop, in the format "Personal Information Exchange".
  4. Give the file a password; you type it again here.
Then run:
  scripts/setup-release-secrets.sh ~/Desktop/DeveloperID.p12
EOF2
  open -a "Keychain Access" 2>/dev/null || true
  exit 1
fi

echo "Signing as: $identity"
echo "Secrets go to: $repository"
read -rsp "Password you gave $(basename "$certificate"): " certificate_password
echo
read -rp "Apple Account email of the developer account: " apple_id
echo "An app-specific password: account.apple.com > Sign-In and Security > App-Specific Passwords > +"
read -rsp "App-specific password: " apple_password
echo
echo "Checking those with Apple's notary service."
if ! xcrun notarytool history --apple-id "$apple_id" --team-id "$team" --password "$apple_password" \
  >/dev/null 2>&1; then
  echo "Apple refused that email and app-specific password for team $team." >&2
  echo "Check the email is the account in that team, make a new app-specific password, and run this again." >&2
  exit 1
fi

base64 -i "$certificate" | gh secret set APPLE_CERTIFICATE --repo "$repository"
printf %s "$certificate_password" | gh secret set APPLE_CERTIFICATE_PASSWORD --repo "$repository"
printf %s "$identity" | gh secret set APPLE_SIGNING_IDENTITY --repo "$repository"
printf %s "$apple_id" | gh secret set APPLE_ID --repo "$repository"
printf %s "$apple_password" | gh secret set APPLE_PASSWORD --repo "$repository"
printf %s "$team" | gh secret set APPLE_TEAM_ID --repo "$repository"

echo
gh secret list --repo "$repository"
echo
echo "Done. Delete $certificate now: GitHub has its own encrypted copy."
