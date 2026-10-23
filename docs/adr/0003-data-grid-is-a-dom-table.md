# 3. The data grid is a windowed DOM table, not a canvas grid

Date: 2026-10-17. Status: accepted.

## Context

The Data area's table view shows up to 1,000 rows a page with inline edits, staged changes, row
selection and keyboard moves. Glide Data Grid was the first choice: it renders to a canvas and is
fast. Version 6.0.3 declares React 18 as its peer, the app runs React 19 with the React Compiler,
and canvas cells have no DOM, so screen readers and Testing Library can't see them. TanStack
Virtual works with a DOM table, but the React Compiler skips any component that calls
`useVirtualizer`, which React Doctor reports as an error.

## Decision

The grid is a `<table>` with fixed 28 px rows. It renders only the rows in view, plus overscan,
from the scroller's position. Spacer rows keep the scroll height right. Each cell's content is a
`<button>`. Only the active cell is in the tab order, and the arrow keys move between cells. Enter
edits a cell and Escape cancels. The query results use the same grid, read-only.

## Consequences

- Cells are real elements: VoiceOver reads them and the tests drive the grid like a user does.
- The React Compiler optimizes the grid, and React Doctor stays at 100.
- Rows can't grow taller to fit their content. Long text and JSON open in the row inspector instead.
- 1,000 rows of DOM is the ceiling for a page. Larger pages would need a canvas grid, which would
  mean revisiting this decision.
