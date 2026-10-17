import { describe, expect, it } from "vitest";

import type { Column } from "@/lib/ipc/bindings";

import { EMPTY_PENDING, withDeleteToggled, withEdit } from "../model";
import { asInserts, asTsv, columnWidth, gridRows } from "./grid-model";

function column(name: string, overrides: Partial<Column> = {}): Column {
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

const columns = [
  column("id", { primaryKey: true, kind: "number", typeName: "integer" }),
  column("email"),
];

describe("gridRows", () => {
  it("puts added rows first and applies edits and deletes", () => {
    let pending = withEdit(EMPTY_PENDING, [{ column: "id", value: "1" }], "email", "a@x", "b@x");
    pending = withDeleteToggled(pending, [{ column: "id", value: "2" }]);
    pending = { ...pending, added: [{ email: "new@x" }] };
    const rows = gridRows(
      columns,
      [
        [1, "a@x"],
        [2, "c@x"],
      ],
      pending,
      0,
    );
    expect(rows.map((row) => [row.id, row.values, row.deleted])).toEqual([
      ["added-0", [null, "new@x"], false],
      ['["1"]', [1, "b@x"], false],
      ['["2"]', [2, "c@x"], true],
    ]);
    expect(rows[1]?.edited).toEqual({ email: "a@x" });
  });

  it("numbers rows without a primary key by position", () => {
    const rows = gridRows([column("note")], [["x"], ["y"]], EMPTY_PENDING, 100);
    expect(rows.map((row) => row.id)).toEqual(["row-100", "row-101"]);
    expect(rows[0]?.key).toBeNull();
  });
});

describe("columnWidth", () => {
  it("sizes by type, then by name", () => {
    expect(columnWidth(column("payload", { kind: "json" }))).toBe(240);
    expect(columnWidth(column("ok", { kind: "bool" }))).toBe(92);
    expect(columnWidth(column("id", { typeName: "uuid" }))).toBe(290);
    expect(columnWidth(column("email"))).toBe(220);
    expect(columnWidth(column("sku"))).toBe(160);
  });
});

describe("copying rows", () => {
  const rows = gridRows(
    columns,
    [
      [1, "o'neil@x"],
      [2, null],
    ],
    EMPTY_PENDING,
    0,
  );

  it("writes tab-separated text with a header", () => {
    expect(asTsv(columns, rows)).toBe("id\temail\n1\to'neil@x\n2\t");
  });

  it("writes inserts with quoted text and NULL", () => {
    expect(asInserts("public.customers", columns, rows)).toBe(
      `insert into public.customers ("id", "email") values (1, 'o''neil@x');\ninsert into public.customers ("id", "email") values (2, NULL);`,
    );
  });
});
