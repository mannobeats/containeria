# Frontend conventions

React 19 with the React Compiler, TypeScript 7 (strict, `exactOptionalPropertyTypes`,
`noUncheckedIndexedAccess`), Vite 8, Tailwind CSS 4, TanStack Query and Router, Radix primitives,
Tabler icons, Motion.

## Layout of `apps/desktop/src`

| Folder | Holds |
|---|---|
| `app/` | Router, query client, query keys, app-wide event wiring. |
| `shell/` | The window frame: sidebar, `Page` top bar, command palette, shortcuts. |
| `features/<area>/` | One folder per sidebar area: `api.ts` (query and mutation hooks), `model.ts` (pure logic, unit-tested), `<area>-page.tsx` and its components. |
| `ui/` | Design-system primitives. No data fetching, no feature imports. |
| `lib/` | Framework-free helpers: formatting, logos, theme, IPC helpers, generated bindings. |
| `styles/` | `tokens.css` (the design tokens) and `app.css` (Tailwind theme and base layer). |

Features import from `ui/`, `lib/` and `app/`, and from another feature only through its `api.ts` or
a component it exists to share (the memory ledger). `ui/` never imports from `features/`.

## Rules

- Files and folders are `kebab-case`; components `PascalCase`; hooks start with `use`.
- Named exports only (configs excepted). One component per file unless the others are private to it.
- Data comes from hooks in `features/<area>/api.ts`. Components never call `commands.*` directly,
  never `useEffect` to fetch, never mirror server state in `useState`.
- Mutations toast what happened with `sonner` (`toast.success("Stopped web")`) and offer Undo when
  the action has an inverse. Errors use `errorMessage(error)`.
- Live data: subscribe with `useTauriEvent` or `useStream` (`lib/ipc`). Both clean up on unmount.
- Keep logic out of components: filtering, grouping and parsing go in `model.ts` with tests.
- No `useMemo`/`useCallback` for performance; the React Compiler memoizes. Use them only when an
  identity is part of an API contract.
- Shared state that isn't server data lives in a small `zustand` store with selector reads
  (`useUi((state) => state.sidebarCollapsed)`), never the whole store.
- Accessibility: every control is a real `button`, `a`, `input` or Radix primitive with a visible
  focus ring (keyboard use only); icon-only buttons have `aria-label` and a `Tip`. A clickable row
  puts a `rowLink` link with `data-row-link` in its first cell, inside a `Table` (or a table with
  `ref={openRowOnClick}`), never `onClick` on `tr`. Don't stretch an `::after` over a row: WebKit
  doesn't contain it in a `tr`, so it covers the whole table.

## Styling

- Every colour, size, radius, shadow and duration is a token from `styles/tokens.css`, exposed to
  Tailwind in `styles/app.css`: `bg-surface`, `text-ink-3`, `text-13`, `rounded-sm`, `shadow-2`,
  `duration-140`. No raw hex, no arbitrary pixel colours.
- Light and dark come from `light-dark()` in the tokens; never write `dark:` variants.
- The brand colour follows the macOS accent (`AccentColor`); use `brand*` tokens, never a fixed blue.
- Hairlines are `0.5px`: `border-b-[0.5px] border-line`, `hairline` for an inset outline.
- Build screens from `ui/` primitives (`Button`, `Menu`, `Sheet`, `Tabs`, `Segmented`, `Tile`, ...).
  Add a primitive there before styling the same thing twice.
- Icons: Tabler (`@tabler/icons-react`) for actions, `CxIcon` for Containeria's own objects, `Tile`
  with `logoFor(...)` for brands. Never draw a logo or a letter monogram.
- Copy is sentence case, says what happened or what to do, and never uses a status dot in a chip.

## Design source

`DESIGN.md` is the contract and `design/` the approved prototype. When building a screen, open the
matching prototype view (`design/js/views/*.js`, `design/css/*.css`) and match it.
