# Containeria

An open-source macOS app that replaces Docker Desktop and OrbStack: containers, Kubernetes, Linux
machines and a database browser, on a Colima engine, with a Tauri UI. Free for commercial use.

- Package managers: `pnpm` for TypeScript, `cargo` for Rust. Never npm or yarn.
- Layout: `apps/desktop` (Tauri app: `src` React UI, `src-tauri` Rust shell and commands),
  `crates/*` (Rust domain crates, one per engine area), `design` (approved HTML prototype, read-only
  reference), `docs` (conventions, architecture, ADRs, feature map).
- Quality gate: `pnpm check` must pass before every commit. It runs Biome, `tsc`, Vitest, React
  Doctor (score 100), fallow, rustfmt, Clippy (pedantic, warnings are errors), `cargo test` and
  cargo-deny. Fix the code; never add a suppression, `@ts-ignore`, `allow` or config exception to get
  green. The few deliberate exceptions are listed in docs/quality-gate.md with their reasons.
- The UI talks to Rust only through generated bindings (`apps/desktop/src/lib/ipc/bindings.ts`, from
  `cargo test -p containeria-app`). Never hand-edit them or call `invoke` directly.
- No comments that restate the code. Doc comments say why, or what a caller must know.
- Latest stable versions only, pinned exactly. Check the registry before adding anything.

## Read before you work

- Writing Rust: docs/rust-conventions.md
- Writing React, TypeScript or CSS: docs/frontend-conventions.md
- Adding a command, event or stream between Rust and the UI: docs/architecture.md
- Changing the look of anything: DESIGN.md, then compare with the prototype in `design/`
- Adding or changing a feature: docs/features.md (what the engine can and can't do)
- Writing tests: docs/testing.md
- Before committing or opening a PR: docs/quality-gate.md
- Recording a decision that future work depends on: docs/adr/

## Skills

`.agents/skills` (also `.claude/skills`) holds engineering workflow skills from
addyosmani/agent-skills. Start with `using-agent-skills` to pick the right one for the task.
