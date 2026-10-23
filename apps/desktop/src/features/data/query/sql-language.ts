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

/** Table and column names for completion, schema-qualified outside the default schema. */
export function completionSchema(namespaces: Namespace[]): Record<string, string[]> {
  const schema: Record<string, string[]> = {};
  namespaces.forEach((namespace, index) => {
    for (const table of namespace.tables) {
      const name = index === 0 ? table.name : `${namespace.name}.${table.name}`;
      schema[name] = table.columns.map((column) => column.name);
    }
  });
  return schema;
}

/** The editor's language: the engine's dialect, highlighting, and completion from the schema. */
export function sqlLanguage(engine: Engine, namespaces: Namespace[]): Extension[] {
  return [
    sql({
      dialect: DIALECTS[engine] ?? StandardSQL,
      schema: completionSchema(namespaces),
      upperCaseKeywords: false,
    }),
    syntaxHighlighting(sqlHighlighter),
  ];
}
