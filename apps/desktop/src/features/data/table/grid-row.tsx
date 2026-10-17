import { IconLink, IconPlus } from "@tabler/icons-react";
import clsx from "clsx";
import { useEffect, useRef } from "react";

import type { Column, Value } from "@/lib/ipc/bindings";
import { Tip } from "@/ui/tooltip";

import { cellText } from "../model";
import { CellEditor, CellValue } from "./cell-value";
import type { GridRow as Row } from "./grid-model";

type CellProps = {
  column: Column;
  value: Value;
  active: boolean;
  editing: boolean;
  edited: boolean;
  before: Value;
  onSelect: (edit: boolean) => void;
  onKey: (event: React.KeyboardEvent) => void;
  onEdit: ((text: string | null) => void) | undefined;
  onStopEdit: () => void;
  onJump: () => void;
};

function cellClass({ active, editing, edited }: Pick<CellProps, "active" | "editing" | "edited">) {
  return clsx(
    "relative h-7 max-w-0 border-r-[0.5px] border-b-[0.5px] border-line p-0 font-mono text-mono-13 text-ink group-hover/row:bg-hover",
    edited &&
      "bg-warn-soft/80 after:pointer-events-none after:absolute after:top-0 after:right-0 after:border-[5px] after:border-transparent after:border-t-warn after:border-r-warn",
    active && "bg-surface shadow-[inset_0_0_0_1.5px_var(--brand)]",
    editing && "overflow-visible",
  );
}

/**
 * One cell. Its content is a button so it can be focused and moved through with the arrow keys;
 * only the active cell is in the tab order.
 */
function Cell(props: CellProps) {
  const {
    column,
    value,
    active,
    editing,
    edited,
    before,
    onSelect,
    onKey,
    onEdit,
    onStopEdit,
    onJump,
  } = props;
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (active && !editing) {
      button.current?.focus({ preventScroll: true });
    }
  }, [active, editing]);
  const finish = (text: string | null | undefined) => {
    onStopEdit();
    if (text !== undefined && text !== cellText(value)) {
      onEdit?.(text);
    }
  };
  return (
    <td
      className={cellClass(props)}
      title={edited ? `Was ${cellText(before) ?? "NULL"}` : undefined}
    >
      {editing && onEdit ? (
        <CellEditor column={column} value={value} onDone={finish} />
      ) : (
        <button
          ref={button}
          type="button"
          tabIndex={active ? 0 : -1}
          onClick={() => onSelect(false)}
          onDoubleClick={() => onSelect(true)}
          onKeyDown={onKey}
          className={clsx(
            "block h-7 w-full truncate px-2.5 outline-none",
            column.kind === "number" ? "text-right tabular" : "text-left",
          )}
        >
          <CellValue value={value} />
        </button>
      )}
      {column.references && value !== null ? (
        <Tip
          label={`Open ${column.references.table} where ${column.references.column} = ${cellText(value)}`}
        >
          <button
            type="button"
            tabIndex={-1}
            aria-label={`Open the ${column.references.table} row`}
            onClick={onJump}
            className="absolute top-1/2 right-1 grid size-5 -translate-y-1/2 place-items-center rounded-xs bg-brand-soft text-brand-ink opacity-0 transition-opacity duration-140 group-hover/row:opacity-100 [&_.tabler-icon]:size-3"
          >
            <IconLink />
          </button>
        </Tip>
      ) : null}
    </td>
  );
}

type RowProps = {
  row: Row;
  number: number;
  columns: Column[];
  selected: boolean;
  activeColumn: number | null;
  editing: boolean;
  onToggle: () => void;
  onSelect: (column: number, edit: boolean) => void;
  onKey: (event: React.KeyboardEvent) => void;
  onEdit: ((column: Column, text: string | null) => void) | undefined;
  onStopEdit: () => void;
  onJump: (column: Column, value: Value) => void;
};

function rowClass(row: Row, selected: boolean) {
  return clsx(
    "group/row",
    selected && "[&>td]:bg-select",
    row.added !== null && "[&>td]:bg-ok-soft/75",
    row.deleted &&
      "[&>td]:bg-bad-soft/75 [&>td]:text-ink-3 [&>td]:line-through [&>td]:decoration-bad",
  );
}

/** One row: its number (click to select the row), then a cell per column. */
export function GridRow({
  row,
  number,
  columns,
  selected,
  activeColumn,
  editing,
  onToggle,
  onSelect,
  onKey,
  onEdit,
  onStopEdit,
  onJump,
}: RowProps) {
  return (
    <tr className={rowClass(row, selected)}>
      <td
        className={clsx(
          "sticky left-0 z-[2] h-7 w-[52px] border-r-[0.5px] border-b-[0.5px] border-r-line-strong border-b-line px-0 text-right font-mono text-mono-12",
          selected ? "bg-brand text-white" : "bg-panel-solid text-ink-3 group-hover/row:bg-hover",
        )}
      >
        <button
          type="button"
          tabIndex={-1}
          aria-pressed={selected}
          aria-label={`Select row ${number}`}
          onClick={onToggle}
          className="h-7 w-full px-2 text-right"
        >
          {row.added === null ? (
            number
          ) : (
            <IconPlus className="ml-auto size-3 text-ok-ink" aria-label="New row" />
          )}
        </button>
      </td>
      {columns.map((column, position) => (
        <Cell
          key={column.name}
          column={column}
          value={row.values[position] ?? null}
          active={activeColumn === position}
          editing={editing && activeColumn === position}
          edited={column.name in row.edited}
          before={row.edited[column.name] ?? null}
          onSelect={(edit) => onSelect(position, edit)}
          onKey={onKey}
          onEdit={onEdit ? (text) => onEdit(column, text) : undefined}
          onStopEdit={onStopEdit}
          onJump={() => onJump(column, row.values[position] ?? null)}
        />
      ))}
    </tr>
  );
}
