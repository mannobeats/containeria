import { useVirtualizer } from "@tanstack/react-virtual";
import { useRef, useState } from "react";

import type { Column, Sort, Value } from "@/lib/ipc/bindings";

import { GridHeader } from "./grid-header";
import { type CellPosition, columnWidth, moveFrom, type GridRow as Row } from "./grid-model";
import { GridRow } from "./grid-row";

type DataGridProps = {
  label: string;
  columns: Column[];
  rows: Row[];
  offset: number;
  sort: Sort | null;
  onSort: (sort: Sort | null) => void;
  selected: ReadonlySet<string>;
  onToggleRow: (row: Row) => void;
  active: CellPosition | null;
  onActive: (position: CellPosition | null) => void;
  /** `undefined` when the grid is read-only. */
  onEdit: ((row: Row, column: Column, text: string | null) => void) | undefined;
  onJump: (column: Column, value: Value) => void;
};

const ROW_HEIGHT = 28;

function Spacer({ height, columns }: { height: number; columns: number }) {
  return height > 0 ? (
    <tr aria-hidden style={{ height }}>
      <td colSpan={columns + 1} />
    </tr>
  ) : null;
}

/** The table grid: virtualized rows, sticky header and row numbers, keyboard moves, in-place edits. */
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
}: DataGridProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const [widths, setWidths] = useState(() => columns.map(columnWidth));
  const [editing, setEditing] = useState(false);
  const virtual = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });
  const items = virtual.getVirtualItems();
  const added = rows.filter((row) => row.added !== null).length;
  const onKey = (event: React.KeyboardEvent) => {
    const move = active ? moveFrom(active, event.key, rows.length, columns.length) : undefined;
    if (move) {
      event.preventDefault();
      onActive(move);
      virtual.scrollToIndex(move.row);
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
          <Spacer height={items[0]?.start ?? 0} columns={columns.length} />
          {items.map((item) => {
            const row = rows[item.index];
            return row ? (
              <GridRow
                key={row.id}
                row={row}
                number={offset + item.index + 1 - added}
                columns={columns}
                selected={selected.has(row.id)}
                activeColumn={active?.row === item.index ? active.column : null}
                editing={editing && active?.row === item.index}
                onToggle={() => onToggleRow(row)}
                onSelect={(column, edit) => {
                  onActive({ row: item.index, column });
                  setEditing(edit && onEdit !== undefined);
                }}
                onKey={onKey}
                onEdit={onEdit ? (column, text) => onEdit(row, column, text) : undefined}
                onStopEdit={() => setEditing(false)}
                onJump={onJump}
              />
            ) : null;
          })}
          <Spacer
            height={virtual.getTotalSize() - (items.at(-1)?.end ?? 0)}
            columns={columns.length}
          />
        </tbody>
      </table>
    </div>
  );
}
