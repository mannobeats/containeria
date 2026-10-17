import { useEffect, useRef, useState } from "react";

import type { Column, Sort, Value } from "@/lib/ipc/bindings";

import { GridHeader } from "./grid-header";
import type { RowActions } from "./grid-menu";
import { type CellPosition, columnWidth, moveFrom, type GridRow as Row } from "./grid-model";
import { GridRow } from "./grid-row";

type DataGridProps = RowActions & {
  label: string;
  columns: Column[];
  rows: Row[];
  offset: number;
  sort: Sort | null;
  /** `undefined` when the rows can't be sorted. */
  onSort: ((sort: Sort | null) => void) | undefined;
  selected: ReadonlySet<string>;
  onToggleRow: (row: Row) => void;
  active: CellPosition | null;
  onActive: (position: CellPosition | null) => void;
  /** `undefined` when the grid is read-only. */
  onEdit: ((row: Row, column: Column, text: string | null) => void) | undefined;
  onJump: (column: Column, value: Value) => void;
};

const ROW_HEIGHT = 28;
const HEADER_HEIGHT = 40;
const OVERSCAN = 12;

/**
 * Fixed-height row windowing: the rows to render at the scroller's position, and scrolling one into
 * view below the sticky header.
 */
function useRowWindow(scroller: React.RefObject<HTMLDivElement | null>, count: number) {
  const [view, setView] = useState({ top: 0, height: 0 });
  useEffect(() => {
    const element = scroller.current;
    if (!element) {
      return;
    }
    const update = () => setView({ top: element.scrollTop, height: element.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    element.addEventListener("scroll", update, { passive: true });
    return () => {
      observer.disconnect();
      element.removeEventListener("scroll", update);
    };
  }, [scroller]);
  const first = Math.max(0, Math.floor(view.top / ROW_HEIGHT) - OVERSCAN);
  const last = Math.min(count, Math.ceil((view.top + view.height) / ROW_HEIGHT) + OVERSCAN);
  const reveal = (index: number) => {
    const element = scroller.current;
    if (!element) {
      return;
    }
    const bottom = HEADER_HEIGHT + (index + 1) * ROW_HEIGHT;
    if (index * ROW_HEIGHT < element.scrollTop) {
      element.scrollTo({ top: index * ROW_HEIGHT });
    } else if (bottom > element.scrollTop + element.clientHeight) {
      element.scrollTo({ top: bottom - element.clientHeight });
    }
  };
  return { first, last, reveal };
}

function Spacer({ height, columns }: { height: number; columns: number }) {
  return height > 0 ? (
    <tr aria-hidden style={{ height }}>
      <td colSpan={columns + 1} />
    </tr>
  ) : null;
}

/** The table grid: windowed rows, sticky header and row numbers, keyboard moves, in-place edits. */
export function DataGrid({
  label,
  columns,
  rows,
  offset,
  sort,
  onSort,
  selected,
  onToggleRow,
  active,
  onActive,
  onEdit,
  onJump,
  table,
  onFilter,
  onDelete,
}: DataGridProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const [widths, setWidths] = useState(() => columns.map(columnWidth));
  const [editing, setEditing] = useState(false);
  const shown = useRowWindow(scroller, rows.length);
  const added = rows.filter((row) => row.added !== null).length;
  const onKey = (event: React.KeyboardEvent) => {
    const move = active ? moveFrom(active, event.key, rows.length, columns.length) : undefined;
    if (move) {
      event.preventDefault();
      onActive(move);
      shown.reveal(move.row);
    } else if (event.key === "Enter" && onEdit) {
      event.preventDefault();
      setEditing(true);
    } else if (event.key === "Escape") {
      onActive(null);
    }
  };
  return (
    <div ref={scroller} className="min-h-0 flex-1 overflow-auto">
      <table
        aria-label={label}
        aria-rowcount={rows.length}
        className="table-fixed border-separate border-spacing-0"
        style={{ width: 52 + widths.reduce((total, width) => total + width, 0) }}
      >
        <colgroup>
          <col style={{ width: 52 }} />
          {columns.map((column, index) => (
            <col key={column.name} style={{ width: widths[index] }} />
          ))}
        </colgroup>
        <GridHeader
          columns={columns}
          widths={widths}
          sort={sort}
          onSort={onSort}
          onResize={(index, width) =>
            setWidths((current) =>
              current.map((old, position) => (position === index ? width : old)),
            )
          }
        />
        <tbody>
          <Spacer height={shown.first * ROW_HEIGHT} columns={columns.length} />
          {rows.slice(shown.first, shown.last).map((row, slot) => {
            const index = shown.first + slot;
            return (
              <GridRow
                key={row.id}
                row={row}
                number={offset + index + 1 - added}
                columns={columns}
                selected={selected.has(row.id)}
                activeColumn={active?.row === index ? active.column : null}
                editing={editing && active?.row === index}
                onToggle={() => onToggleRow(row)}
                onSelect={(column, edit) => {
                  onActive({ row: index, column });
                  setEditing(edit && onEdit !== undefined);
                }}
                onKey={onKey}
                onEdit={onEdit ? (column, text) => onEdit(row, column, text) : undefined}
                onStopEdit={() => setEditing(false)}
                onJump={onJump}
                actions={{ table, onEdit, onFilter, onDelete }}
              />
            );
          })}
          <Spacer height={(rows.length - shown.last) * ROW_HEIGHT} columns={columns.length} />
        </tbody>
      </table>
    </div>
  );
}
