import { MySQL, PostgreSQL, type SQLDialect, SQLite, StandardSQL, sql } from "@codemirror/lang-sql";
import { syntaxHighlighting } from "@codemirror/language";
import type { Extension } from "@codemirror/state";

import type { Engine, Namespace } from "@/lib/ipc/bindings";

import { sqlHighlighter } from "../sql-highlight";

const DIALECTS: Partial<Record<Engine, SQLDialect>> = {
  postgres: PostgreSQL,
  mysql: MySQL,
  mariadb: MySQL,
  sqlite: SQLite,
};

/**
 * Table and column names for completion, each under its schema. Tables in the first schema also
 * complete without one, so `orders.` and `public.orders.` both offer the columns.
 */
export function completionSchema(namespaces: Namespace[]) {
  const schema = Object.fromEntries(
    namespaces.flatMap((namespace) =>
      namespace.tables.map((table) => [
        `${namespace.name}.${table.name}`,
        table.columns.map((column) => column.name),
      ]),
    ),
  );
  const first = namespaces[0]?.name;
  return first === undefined ? { schema } : { schema, defaultSchema: first };
}

/** The editor's language: the engine's dialect, highlighting, and completion from the schema. */
export function sqlLanguage(engine: Engine, namespaces: Namespace[]): Extension[] {
  return [
    sql({
      dialect: DIALECTS[engine] ?? StandardSQL,
      ...completionSchema(namespaces),
      upperCaseKeywords: false,
    }),
    syntaxHighlighting(sqlHighlighter),
  ];
}
