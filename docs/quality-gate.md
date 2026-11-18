# Quality gate

`pnpm check` runs everything below. CI runs the same command. A change is done when it passes with
no new suppressions.

| Tool | Checks | Command |
|---|---|---|
| Biome | Lint and format for TS, JSON and CSS | `biome ci .` |
| TypeScript 7 | Types | `pnpm --filter @containeria/desktop typecheck` |
| Vitest | TS unit tests | `pnpm --filter @containeria/desktop test` |
| React Doctor | React correctness, performance and architecture; score must be 100 | `pnpm check:react` |
| fallow | Unused files, exports and dependencies, duplication, complexity, cycles | `pnpm check:fallow` |
| rustfmt | Rust format | `cargo fmt --all --check` |
| Clippy | All + pedantic lints, warnings are errors | `cargo clippy --workspace --all-targets --locked -- -D warnings` |
| Clippy, for Linux | The same for the guest agent, whose Linux code a Mac build skips | `cargo clippy -p containeria-agent --target aarch64-unknown-linux-musl --all-targets --locked -- -D warnings` |
| cargo test | Rust unit tests, and regenerates `bindings.ts` | `cargo test --workspace --locked` |
| cargo-deny | Advisories, licenses, sources | `cargo deny check`, and again for the agent's Linux dependencies |

CI also fails if `bindings.ts` differs after `cargo test`: commit the regenerated file.

`pnpm fix` applies Biome's safe fixes and `cargo fmt`.

## Deliberate exceptions

Each one is a configuration decision with a reason, not a way around a finding.

| Where | Exception | Why |
|---|---|---|
| `biome.json` | `performance/noJsxPropsBind` off | The React Compiler memoizes inline callbacks; the rule predates it. |
| `biome.json` | `correctness/noUnresolvedImports` off | TypeScript already resolves every import and Biome misreads `@types/react`. |
| `biome.json` | `design/`, `src/assets/logos`, `bindings.ts` ignored | Archived prototype, third-party brand files, generated code. |
| `.fallowrc.json` | same paths ignored | Same reasons. |
| `deny.toml` | `RUSTSEC-2024-0436` ignored | `paste` is unmaintained but only a compile-time proc-macro inside specta; no vulnerability. |
| `deny.toml` | `RUSTSEC-2026-0543` ignored | `chrono` is marked unmaintained, with no vulnerability reported. The types of `bollard` and `sqlx` are made of it, so it can't be replaced from here. Remove once they move on. |
| `src-tauri/src/ipc.rs` | `too_many_lines` expected on `commands()` | It is the list of every IPC command, one path per line, and tauri-specta only accepts them in a single `collect_commands!`. |
| Rust | `#[expect(lint, reason)]` on single items | Documented where the lint is wrong for that item, e.g. the list of every IPC command. |
| `vmm/` | Swift, outside the Rust gate | Apple Virtualization and FSEvents are Apple's own APIs; calling them from Rust needs `unsafe`, which the workspace forbids. The helper is six small files and is exercised by the engine's end-to-end test. |
| `guest/patches/` | C, outside the Rust gate | One patch to the guest's Linux kernel: Linux raises no event for a file the Mac changed, and goes on trusting what it cached of it. Neither can be mended outside the kernel. The patch says what it is for; the guest's build fails if it no longer applies, and the engine's end-to-end test fails if it stops working. |

Adding to this table needs a reason a reviewer would accept. Prefer changing the code.
