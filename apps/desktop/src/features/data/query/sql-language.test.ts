import { describe, expect, it } from "vitest";

import type { Namespace, Table } from "@/lib/ipc/bindings";

import { completionSchema, sqlLanguage } from "./sql-language";

function table(name: string, columns: string[]): Table {
  return {
    schema: null,
    name,
    kind: "table",
    rowEstimate: null,
    sizeBytes: null,
    indexes: [],
    columns: columns.map((column) => ({
      name: column,
      typeName: "text",
      kind: "text",
      nullable: true,
      primaryKey: false,
      references: null,
      default: null,
    })),
  };
}

describe("completionSchema", () => {
  it("qualifies tables outside the default schema", () => {
    const namespaces: Namespace[] = [
      { name: "public", tables: [table("orders", ["id", "total"])], functions: [], enums: [] },
      { name: "auth", tables: [table("users", ["email"])], functions: [], enums: [] },
    ];
    expect(completionSchema(namespaces)).toEqual({
      orders: ["id", "total"],
      "auth.users": ["email"],
    });
    expect(sqlLanguage("postgres", namespaces)).toHaveLength(2);
    expect(sqlLanguage("clickhouse", [])).toHaveLength(2);
  });
});
