# Releasing

A tag `v*` runs `.github/workflows/release.yml`: it builds the guest on Linux, the engine and
the app on a Mac, and publishes the disk image on the GitHub release.

```sh
git tag -a v0.2.0 -m "Contena 0.2.0" && git push origin v0.2.0
```

## Signed and notarized

A disk image that opens on any Mac without a warning needs a Developer ID signature on the app
and on every program inside it, and Apple's notarization of the result. The workflow does both
when the repository has six secrets, and publishes an ad-hoc signed build, which macOS asks
about at its first launch, when it doesn't.

One-time setup, by whoever holds the Apple Developer account:

1. A **Developer ID Application** certificate in the login keychain (Xcode → Settings →
   Accounts → Manage Certificates). One certificate signs every app of the team; nothing is
   registered for Contena itself, since it uses no capability that needs Apple's approval.
2. An **app-specific password** for the Apple Account, from account.apple.com → Sign-In and
   Security. Apple shows it once.
3. `scripts/setup-release-secrets.sh ~/Desktop/DeveloperID.p12`, which asks for both, checks
   them with Apple and stores `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`,
   `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD` and `APPLE_TEAM_ID` as secrets of the
   repository. Run without the file, it says how to export the certificate.

## Updates

An installed Contena finds a release by itself and installs it (Settings → About). For that a
release also publishes `Contena.app.tar.gz`, the notarized app as an archive signed with
Contena's update key, and `latest.json`, which names the version and carries the signature.
The app reads `releases/latest/download/latest.json` and accepts only an archive that the
public key in `tauri.conf.json` (`plugins.updater.pubkey`) verifies.

`scripts/setup-update-key.sh` makes the key once and stores its private half as the secrets
`TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. The key is at
`~/.tauri/contena.key` and its password in the login keychain as "Contena update key". **Back
both up.** Without them no update can be sent to anyone who has the app; they would have to
download the next version by hand.

The workflow publishes the two files only when the release is also signed and notarized.
Versions before 0.1.2 have no updater and are replaced by hand.

## What signs what

- `scripts/sign-inside.sh` signs the engine, the VM helper and the bundled tools (`docker`,
  `kubectl`, `cx`, Compose, Buildx) with `APPLE_SIGNING_IDENTITY`, the hardened runtime and
  Apple's timestamp. Tauri doesn't sign what lies in the app's resources, and Apple refuses an
  app with a program in it that isn't signed this way. The VM helper keeps its one
  entitlement, `com.apple.security.virtualization`, which a Developer ID may use freely.
- Tauri signs the app and the disk image with the same identity, and notarizes the app when
  `APPLE_ID`, `APPLE_PASSWORD` and `APPLE_TEAM_ID` are set.
- `scripts/notarize.sh` notarizes the disk image, staples Apple's ticket to it and asks
  Gatekeeper whether it would open.

## On your own Mac

```sh
export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)"
export APPLE_ID=you@example.com APPLE_PASSWORD=app-specific-password APPLE_TEAM_ID=TEAMID
sh scripts/fetch-tools.sh && sh scripts/build-guest.sh && sh scripts/build-engine.sh
pnpm build
sh scripts/notarize.sh target/release/bundle/dmg/*.dmg
```

Without the variables the same commands make an ad-hoc signed build.
