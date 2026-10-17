import type {
  Column,
  Connection,
  Detected,
  Namespace,
  RowPage,
  ServerInfo,
  Table,
} from "@/lib/ipc/bindings";

export function infoFixture(overrides: Partial<ServerInfo> = {}): ServerInfo {
  return {
    id: "pg",
    name: "shop-db",
    engine: "postgres",
    provider: null,
    version: "PostgreSQL 18.0",
    capabilities: { sql: true, editRows: true, tables: true, keys: false },
    environment: "local",
    readOnly: false,
    writableUntilMs: null,
    ...overrides,
  };
}

export function columnFixture(name: string, overrides: Partial<Column> = {}): Column {
  return {
    name,
    typeName: "text",
    kind: "text",
    nullable: true,
    primaryKey: false,
    references: null,
    default: null,
    ...overrides,
  };
}

export const usersTable: Table = {
  schema: "public",
  name: "users",
  kind: "table",
  rowEstimate: 2,
  sizeBytes: 16_384,
  columns: [
    columnFixture("id", { typeName: "int8", kind: "number", nullable: false, primaryKey: true }),
    columnFixture("email"),
    columnFixture("team_id", {
      typeName: "int8",
      kind: "number",
      references: { schema: "public", table: "teams", column: "id" },
    }),
  ],
  indexes: [{ name: "users_email_key", columns: ["email"], unique: true }],
};

export const teamsTable: Table = {
  schema: "public",
  name: "teams",
  kind: "table",
  rowEstimate: 1,
  sizeBytes: null,
  columns: [
    columnFixture("id", { typeName: "int8", kind: "number", nullable: false, primaryKey: true }),
    columnFixture("name"),
  ],
  indexes: [],
};

export const namespacesFixture: Namespace[] = [
  {
    name: "public",
    tables: [usersTable, teamsTable, { ...teamsTable, name: "active_teams", kind: "view" }],
    functions: ["now_utc"],
    enums: [{ name: "role", values: ["admin", "member"] }],
  },
];

export function pageFixture(overrides: Partial<RowPage> = {}): RowPage {
  return {
    columns: usersTable.columns,
    rows: [
      [1, "ada@example.com", 7],
      [2, null, null],
    ],
    total: 2,
    totalCapped: false,
    elapsedMs: 4,
    readOnlyReason: null,
    ...overrides,
  };
}

export function connectionFixture(overrides: Partial<Connection> = {}): Connection {
  return {
    id: "pg",
    name: "billing",
    engine: "postgres",
    provider: null,
    host: "db.internal",
    port: 5432,
    user: "app",
    database: "billing",
    file: null,
    tls: true,
    environment: "production",
    hasPassword: true,
    ...overrides,
  };
}

export function detectedFixture(overrides: Partial<Detected> = {}): Detected {
  return {
    id: "container:shop-db-1",
    containerId: "c0ffee",
    containerName: "shop-db-1",
    image: "postgres:18",
    engine: "postgres",
    running: true,
    port: 5433,
    user: "postgres",
    database: "shop",
    passwordSource: "POSTGRES_PASSWORD",
    ...overrides,
  };
}
