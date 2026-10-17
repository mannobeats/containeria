# Contributing

Thanks for helping. Containeria holds a high bar on purpose: every change passes the full quality
gate and matches the design.

## Set up

```sh
pnpm install
pnpm dev
```

| Variable | Effect |
|---|---|
| `CONTAINERIA_DOCKER_SOCKET` | Use this Docker socket instead of starting Containeria's engine. |
| `CONTAINERIA_HOME` | Where engine state lives. Default `~/.containeria`. |
| `CONTAINERIA_COLIMA` | Path to a Colima binary to use instead of the bundled or installed one. |
| `RUST_LOG` | Rust log filter, for example `info` or `containeria_app=debug`. |

## Making a change

1. Read the convention doc for the area you touch (linked from [AGENTS.md](AGENTS.md)).
2. Keep the change to one concern. Add or update tests with it.
3. Run `pnpm check` until it passes. Don't silence a check; fix the cause.
4. For UI work, run the app and check light and dark, at 1440 and 1024 wide.
5. Commit with a message in the imperative that says what changed and why.

## Pull requests

Describe what changed, why, and how you verified it (commands, screenshots for UI). CI runs the
same gate on macOS.
