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
| cargo test | Rust unit tests, and regenerates `bindings.ts` | `cargo test --workspace --locked` |
| cargo-deny | Advisories, licenses, sources | `cargo deny check` |

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
| Rust | `#[expect(lint, reason)]` on single items | Documented where the lint is wrong for that item, e.g. a struct mirroring Colima's config. |

Adding to this table needs a reason a reviewer would accept. Prefer changing the code.
