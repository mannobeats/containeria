import type {
  Cell,
  ChangeSet,
  Column,
  ConnectionInput,
  Engine,
  Filter,
  FilterOp,
  Namespace,
  Table,
  TableRef,
  Value,
} from "@/lib/ipc/bindings";

/** `public.orders`, or `orders` when the table has no schema. */
export function tableKey(table: TableRef | Table): string {
  return table.schema ? `${table.schema}.${table.name}` : table.name;
}

export function findTable(namespaces: Namespace[], key: string): Table | undefined {
  return namespaces
    .flatMap((namespace) => namespace.tables)
    .find((table) => tableKey(table) === key);
}

export function tableRef(table: Table): TableRef {
  return { schema: table.schema, name: table.name };
}

/** A cell as text: what the grid shows, what an edit starts from, what a key sends back. */
export function cellText(value: Value): string | null {
  if (value === null) {
    return null;
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

export const FILTER_OPS: { op: FilterOp; label: string; needsValue: boolean }[] = [
  { op: "equals", label: "=", needsValue: true },
  { op: "notEquals", label: "≠", needsValue: true },
  { op: "greater", label: ">", needsValue: true },
  { op: "less", label: "<", needsValue: true },
  { op: "greaterOrEqual", label: "≥", needsValue: true },
  { op: "lessOrEqual", label: "≤", needsValue: true },
  { op: "contains", label: "contains", needsValue: true },
  { op: "startsWith", label: "starts with", needsValue: true },
  { op: "isNull", label: "is null", needsValue: false },
  { op: "isNotNull", label: "is not null", needsValue: false },
];

export function opLabel(op: FilterOp): string {
  return FILTER_OPS.find((entry) => entry.op === op)?.label ?? op;
}

/** Edits to one existing row, found by its primary key. */
export type RowEdit = { key: Cell[]; set: Record<string, { before: Value; value: string | null }> };

/** Everything staged for one table and not yet committed. */
export type Pending = {
  edits: Record<string, RowEdit>;
  added: Record<string, string | null>[];
  deleted: Record<string, Cell[]>;
};

export const EMPTY_PENDING: Pending = { edits: {}, added: [], deleted: {} };

/** The primary-key cells of a row, or `null` when the table has no primary key. */
export function keyCells(row: Value[], columns: Column[]): Cell[] | null {
  const cells = columns.flatMap((column, index) =>
    column.primaryKey ? [{ column: column.name, value: cellText(row[index] ?? null) }] : [],
  );
  return cells.length > 0 ? cells : null;
}

export function rowId(key: Cell[]): string {
  return JSON.stringify(key.map((cell) => cell.value));
}

export function pendingCount(pending: Pending): number {
  const edited = Object.values(pending.edits).reduce(
    (total, edit) => total + Object.keys(edit.set).length,
    0,
  );
  return edited + pending.added.length + Object.keys(pending.deleted).length;
}

/** Records an edit; editing a cell back to what it was removes the edit. */
export function withEdit(
  pending: Pending,
  key: Cell[],
  column: string,
  before: Value,
  value: string | null,
): Pending {
  const id = rowId(key);
  const current = pending.edits[id] ?? { key, set: {} };
  const set = { ...current.set };
  const staged = set[column];
  const original = staged ? staged.before : before;
  if (cellText(original) === value) {
    delete set[column];
  } else {
    set[column] = { before: original, value };
  }
  const edits = { ...pending.edits };
  if (Object.keys(set).length === 0) {
    delete edits[id];
  } else {
    edits[id] = { key, set };
  }
  return { ...pending, edits };
}

export function withDeleteToggled(pending: Pending, key: Cell[]): Pending {
  const id = rowId(key);
  const deleted = { ...pending.deleted };
  if (deleted[id]) {
    delete deleted[id];
  } else {
    deleted[id] = key;
  }
  return { ...pending, deleted };
}

/**
 * Deleting selected rows: an added row is simply dropped; a row from the database is marked, or
 * unmarked when it already was.
 */
export function withRowsDeleted(
  pending: Pending,
  rows: { added: number | null; key: Cell[] | null }[],
): Pending {
  const dropped = new Set(rows.flatMap((row) => (row.added === null ? [] : [row.added])));
  let next: Pending = {
    ...pending,
    added: pending.added.filter((_, index) => !dropped.has(index)),
  };
  for (const row of rows) {
    if (row.added === null && row.key) {
      next = withDeleteToggled(next, row.key);
    }
  }
  return next;
}

/** What a commit sends: only columns that changed, rows by primary key. */
export function toChangeSet(pending: Pending, table: TableRef): ChangeSet {
  const cells = (values: Record<string, string | null>) =>
    Object.entries(values).map(([column, value]) => ({ column, value }));
  return {
    table,
    updates: Object.values(pending.edits).map((edit) => ({
      key: edit.key,
      set: Object.entries(edit.set).map(([column, change]) => ({ column, value: change.value })),
    })),
    inserts: pending.added.map((values) =>
      cells(Object.fromEntries(Object.entries(values).filter(([, value]) => value !== ""))),
    ),
    deletes: Object.values(pending.deleted),
  };
}

export function pendingSummary(pending: Pending): string {
  const edited = pendingCount({ ...pending, added: [], deleted: {} });
  const parts = [
    edited > 0 ? `${edited} edited` : null,
    pending.added.length > 0 ? `${pending.added.length} added` : null,
    Object.keys(pending.deleted).length > 0
      ? `${Object.keys(pending.deleted).length} deleted`
      : null,
  ];
  return parts.filter(Boolean).join(" · ");
}

export const filterKey = (filter: Filter) =>
  JSON.stringify([filter.column, filter.op, filter.value]);

/** The filters with repeats dropped: the same filter twice narrows nothing further. */
export function uniqueFilters(filters: Filter[]): Filter[] {
  return [...new Map(filters.map((filter) => [filterKey(filter), filter])).values()];
}

/** How the filters read as SQL, for the hint beside them. Display only. */
export function whereText(filters: Filter[]): string {
  return filters
    .map((filter) => {
      if (filter.op === "isNull" || filter.op === "isNotNull") {
        return `${filter.column} ${opLabel(filter.op)}`;
      }
      return `${filter.column} ${opLabel(filter.op)} '${filter.value ?? ""}'`;
    })
    .join(" and ");
}

const SCHEMES: Record<string, Engine> = {
  postgres: "postgres",
  postgresql: "postgres",
  mysql: "mysql",
  mariadb: "mariadb",
  mongodb: "mongodb",
  "mongodb+srv": "mongodb",
  redis: "redis",
  rediss: "redis",
  clickhouse: "clickhouse",
  sqlite: "sqlite",
};

/** Percent-decodes, keeping a stray `%` as typed: `p%ss` is a real password. */
function decode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/** Reads `postgres://user:pass@host:5432/db?sslmode=require` into the connection form. */
export function parseConnectionUrl(text: string): Partial<ConnectionInput> | null {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    return null;
  }
  const engine = SCHEMES[url.protocol.replace(/:$/, "").toLowerCase()];
  if (!engine) {
    return null;
  }
  const params = url.searchParams;
  const tls =
    ["require", "verify-ca", "verify-full"].includes(params.get("sslmode") ?? "") ||
    params.get("ssl") === "true" ||
    url.protocol === "rediss:";
  const database = decode(url.pathname.replace(/^\//, ""));
  return {
    engine,
    host: url.hostname,
    port: url.port ? Number(url.port) : null,
    user: url.username ? decode(url.username) : null,
    password: url.password ? decode(url.password) : null,
    database: database || null,
    tls,
    name: url.hostname.split(".")[0] ?? "",
  };
}

/** 182400311 → "182.4M", 41022 → "41k", 214 → "214". */
export function compactCount(count: number | null): string {
  if (count === null) {
    return "";
  }
  if (count >= 1e6) {
    return `${(count / 1e6).toFixed(1)}M`;
  }
  if (count >= 1e4) {
    return `${Math.round(count / 1e3)}k`;
  }
  return count.toLocaleString("en-US");
}
