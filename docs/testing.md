# Testing

- **Rust**: unit tests in `#[cfg(test)] mod tests` beside the code. Test parsing of engine output
  with real samples (Colima JSON, Docker stats), conversions, and decisions (ledger grouping). Tests
  must not need a running engine; anything that does goes behind `#[ignore = "needs a Docker engine"]`
  and runs with `cargo test -- --ignored` locally. The database tests in
  `crates/data/src/live_tests.rs` list the throwaway `containeria-test-*` containers they need
  and the command that removes them afterwards.
- **TypeScript**: Vitest with happy-dom. Test `model.ts` logic and `lib/` helpers as plain
  functions; test a component with Testing Library only when it holds logic a user would notice
  breaking. Files sit next to the code as `*.test.ts(x)`.
- Components are tested through the user's eyes: `renderWithApp(<Page />)` from `src/test/harness`
  renders inside the app's providers, `mockCommands({ containersList: () => [...] })` answers Tauri
  commands, typed by what each Rust command returns, and records every call, and `src/test/fixtures` builds typed sample
  data. Assert on roles and text, then on the recorded IPC calls. Pages that read route params
  render with `renderWithApp(<ImagePage />, { route: { path: "images/$id", url: "/images/sha256:pg" } })`.
- fallow scores every function's CRAP (complexity × untested) from Vitest coverage. A component with
  branches needs a test that exercises them; keep functions under 60 lines and cognitive complexity
  under 15 by extracting subcomponents and hooks.
- **Fuzzing**: `fuzz/` holds cargo-fuzz targets for the parsers any local process can reach: the
  DNS server's packet handling and the proxy's Host and SNI names. Each asserts a property, not just
  "no panic". The Fuzz workflow runs them weekly and when `crates/net` changes; locally,
  `cd fuzz && cargo +nightly fuzz run dns_answer`. A new parser of untrusted input gets a target,
  exposed through `containeria_net::fuzzing`.
- Name tests after behaviour (`"keeps standalone containers last"`), one behaviour each.
- A bug fix starts with a failing test that reproduces it.
- Never skip, delete or loosen a test to get the gate green.
- UI changes are checked by running the app (`pnpm dev`, see CONTRIBUTING.md) in light and dark at
  1440 and 1024 wide, as DESIGN.md requires.
