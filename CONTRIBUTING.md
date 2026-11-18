# Contributing

Thanks for helping. Contena holds a high bar on purpose: every change passes the full quality
gate and matches the design.

## Set up

```sh
pnpm install
pnpm dev
```

| Variable | Effect |
|---|---|
| `CONTENA_DOCKER_SOCKET` | Use this Docker socket instead of starting Contena's engine. |
| `CONTENA_KUBE_CONTEXT` | Use this kubeconfig context instead of the engine's `contena`, and treat Kubernetes as on. |
| `CONTENA_HOME` | Where engine state lives. Default `~/.contena`. |
| `CONTENA_ENGINE` | Path to a `contena-engine` to run instead of the bundled one. |
| `CONTENA_VMM`, `CONTENA_GUEST` | For the engine: the VM helper and the folder with the guest's `Image` and `rootfs.erofs`, instead of the ones beside it. |
| `RUST_LOG` | Rust log filter, for example `info` or `contena_app=debug`. |

Cargo never deletes a build it has replaced, so `target/` keeps growing with every dependency or
toolchain update. Run `cargo clean` now and then; the next `pnpm check` rebuilds what it needs.

## Making a change

1. Read the convention doc for the area you touch (linked from [AGENTS.md](AGENTS.md)).
2. Keep the change to one concern. Add or update tests with it.
3. Run `pnpm check` until it passes. Don't silence a check; fix the cause.
4. For UI work, run the app and check light and dark, at 1440 and 1024 wide.
5. Commit with a message in the imperative that says what changed and why.

## Pull requests

Describe what changed, why, and how you verified it (commands, screenshots for UI). CI runs the
same gate on macOS.
