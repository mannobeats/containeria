# Security

Containeria runs a VM, talks to the Docker socket, stores database passwords in the macOS Keychain
and, for domains and HTTPS, installs a local certificate authority. Please report vulnerabilities
privately through GitHub's "Report a vulnerability" on this repository
(<https://github.com/mannobeats/containeria/security/advisories/new>), not in a public issue.
We aim to reply within three working days.

## Checking a download

Each release's disk image carries a build provenance attestation from the GitHub Actions run that
built it. Check one with:

```sh
gh attestation verify Containeria_*.dmg --repo mannobeats/containeria
```

## What runs on this repository

CodeQL scans the Rust, TypeScript and workflow code on every push. Secret scanning with push
protection, Dependabot alerts and security updates, OpenSSF Scorecard and a dependency review on
every pull request run too. `cargo deny` checks Rust advisories and licences in `pnpm check`.
