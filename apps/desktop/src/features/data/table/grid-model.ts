import type { Cell, Column, Sort, Value } from "@/lib/ipc/bindings";

import { cellText, keyCells, type Pending, rowId } from "../model";

/** A row as the grid draws it: read from the database, or added and not committed yet. */
export type GridRow = {
  id: string;
  values: Value[];
  key: Cell[] | null;
  added: number | null;
  deleted: boolean;
  /** Edited columns, with the value they had. */
  edited: Record<string, Value>;
};

/** Merges a page of rows with what's staged: added rows first, edits and deletes applied. */
export function gridRows(
  columns: Column[],
  rows: Value[][],
  pending: Pending,
  offset: number,
): GridRow[] {
  const added = pending.added.map<GridRow>((values, index) => ({
    id: `added-${index}`,
    values: columns.map((column) => values[column.name] ?? null),
    key: null,
    added: index,
    deleted: false,
    edited: {},
  }));
  const read = rows.map<GridRow>((values, index) => {
    const key = keyCells(values, columns);
    const id = key ? rowId(key) : `row-${offset + index}`;
    const edit = key ? pending.edits[id] : undefined;
    return {
      id,
      key,
      added: null,
      deleted: Boolean(pending.deleted[id]),
      values: columns.map((column, position) => {
        const change = edit?.set[column.name];
        return change ? change.value : (values[position] ?? null);
      }),
      edited: Object.fromEntries(
        Object.entries(edit?.set ?? {}).map(([column, change]) => [column, change.before]),
      ),
    };
  });
  return [...added, ...read];
}

/** A sensible starting width for a column, from its type and name. */
export function columnWidth(column: Column): number {
  if (column.kind === "json") {
    return 240;
  }
  if (column.kind === "time") {
    return 180;
  }
  if (column.kind === "bool") {
    return 92;
  }
  if (column.kind === "number") {
    return 120;
  }
  if (/uuid|char\(36\)/i.test(column.typeName)) {
    return 290;
  }
  return /email|title|name|path|body|message|description|url/i.test(column.name) ? 220 : 160;
}

/** Tab-separated text of the rows, the way spreadsheets paste it. */
export function asTsv(columns: Column[], rows: GridRow[]): string {
  const header = columns.map((column) => column.name).join("\t");
  const lines = rows.map((row) =>
    row.values.map((value) => (cellText(value) ?? "").replace(/[\t\n]/g, " ")).join("\t"),
  );
  return [header, ...lines].join("\n");
}

/** One row as a JSON object of column to value, for "Copy as JSON". */
export function asJson(columns: Column[], row: GridRow): string {
  return JSON.stringify(
    Object.fromEntries(columns.map((column, index) => [column.name, row.values[index] ?? null])),
    null,
    2,
  );
}

/** The selected rows as SQL inserts, for "Copy as insert". Display text only. */
export function asInserts(table: string, columns: Column[], rows: GridRow[]): string {
  const names = columns.map((column) => `"${column.name.replace(/"/g, '""')}"`).join(", ");
  return rows
    .map((row) => {
      const values = row.values
        .map((value) => {
          const text = cellText(value);
          if (text === null) {
            return "NULL";
          }
          return typeof value === "number" || typeof value === "boolean"
            ? text
            : `'${text.replace(/'/g, "''")}'`;
        })
        .join(", ");
      return `insert into ${table} (${names}) values (${values});`;
    })
    .join("\n");
}

export type CellPosition = { row: number; column: number };

/** Ascending, then descending, then unsorted. */
export function nextSort(current: Sort | null, column: string): Sort | null {
  if (current?.column !== column) {
    return { column, descending: false };
  }
  return current.descending ? null : { column, descending: true };
}

/** The cell a key moves to from `from`, or `undefined` for a key the grid doesn't use. */
export function moveFrom(
  from: CellPosition,
  key: string,
  rows: number,
  columns: number,
): CellPosition | undefined {
  const moves: Record<string, CellPosition> = {
    ArrowUp: { row: Math.max(0, from.row - 1), column: from.column },
    ArrowDown: { row: Math.min(rows - 1, from.row + 1), column: from.column },
    ArrowLeft: { row: from.row, column: Math.max(0, from.column - 1) },
    ArrowRight: { row: from.row, column: Math.min(columns - 1, from.column + 1) },
  };
  return moves[key];
}
