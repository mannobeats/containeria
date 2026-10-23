import { copyText } from "@/lib/clipboard";
import type { Column, Sort, Value } from "@/lib/ipc/bindings";
import type { MenuEntry } from "@/ui/menu";

import { cellText } from "../model";
import { asInserts, asJson, type GridRow } from "./grid-model";

/** What a right-click on a row can do besides copying; each is `undefined` where it can't. */
export type RowActions = {
  /** The table to write inserts for; query results have none. */
  table: string | undefined;
  onEdit: ((row: GridRow, column: Column, text: string | null) => void) | undefined;
  onFilter: ((column: Column, value: Value) => void) | undefined;
  onDelete: ((row: GridRow) => void) | undefined;
};

/** Values a cell can be set to without typing. */
function setters(
  row: GridRow,
  column: Column,
  value: Value,
  onEdit: (row: GridRow, column: Column, text: string | null) => void,
): MenuEntry[] {
  return [
    ...(column.nullable && value !== null
      ? [{ label: "Set to NULL", onSelect: () => onEdit(row, column, null) }]
      : []),
    // The editor reads an emptied NULL cell as untouched, so this is how to store "".
    ...(column.kind === "text" && value !== ""
      ? [{ label: "Set to Empty String", onSelect: () => onEdit(row, column, "") }]
      : []),
  ];
}

/** The menu for a row, and for the cell in `column` when the click landed on one. */
export function cellMenu(
  columns: Column[],
  row: GridRow,
  column: number | undefined,
  { table, onEdit, onFilter, onDelete }: RowActions,
): MenuEntry[] {
  const target = column === undefined ? undefined : columns[column];
  const value = column === undefined ? null : (row.values[column] ?? null);
  const actions: MenuEntry[] = target
    ? [
        ...(onEdit && !row.deleted ? setters(row, target, value, onEdit) : []),
        ...(onFilter
          ? [{ label: "Filter by This Value", onSelect: () => onFilter(target, value) }]
          : []),
      ]
    : [];
  return [
    ...actions,
    ...(actions.length > 0 ? [{ kind: "separator" as const }] : []),
    ...(target
      ? [{ label: "Copy Value", onSelect: () => copyText("Value", cellText(value) ?? "NULL") }]
      : []),
    { label: "Copy Row as JSON", onSelect: () => copyText("Row", asJson(columns, row)) },
    ...(table
      ? [
          {
            label: "Copy Row as INSERT",
            onSelect: () => copyText("Insert", asInserts(table, columns, [row])),
          },
        ]
      : []),
    ...(onDelete
      ? [
          { kind: "separator" as const },
          row.deleted
            ? { label: "Restore Row", onSelect: () => onDelete(row) }
            : { label: "Delete Row", danger: true, onSelect: () => onDelete(row) },
        ]
      : []),
  ];
}

/** The menu for a column header: sorting, where the grid sorts, and copying the name. */
export function headerMenu(
  column: Column,
  sort: Sort | null,
  onSort: ((sort: Sort | null) => void) | undefined,
): MenuEntry[] {
  const sorted = sort?.column === column.name ? sort : null;
  return [
    ...(onSort
      ? [
          {
            label: "Sort Ascending",
            checked: sorted?.descending === false,
            onSelect: () => onSort({ column: column.name, descending: false }),
          },
          {
            label: "Sort Descending",
            checked: sorted?.descending === true,
            onSelect: () => onSort({ column: column.name, descending: true }),
          },
          { kind: "separator" as const },
        ]
      : []),
    { label: "Copy Column Name", onSelect: () => copyText("Column", column.name) },
  ];
}
