import { describe, expect, it } from "vitest";

import { usersTable } from "@/test/data-fixtures";

import {
  autoMatch,
  exportFormat,
  fileName,
  importedShare,
  importFormat,
  sampleRows,
  toMapping,
  withMatch,
} from "./import-model";

describe("import model", () => {
  it("reads JSON and NDJSON files as JSON, anything else as CSV", () => {
    expect(importFormat("/tmp/users.JSON")).toBe("json");
    expect(importFormat("/tmp/events.ndjson")).toBe("json");
    expect(importFormat("/tmp/events.jsonl")).toBe("json");
    expect(importFormat("/tmp/users.tsv")).toBe("csv");
    expect(fileName("/Users/ada/users.csv")).toBe("users.csv");
  });

  it("exports in the format the file name asks for", () => {
    expect(exportFormat("/tmp/users.sql")).toBe("sql");
    expect(exportFormat("/tmp/users.json")).toBe("json");
    expect(exportFormat("/tmp/users")).toBe("csv");
  });

  it("matches columns by name, each table column once, and skips the rest", () => {
    const matches = autoMatch(["ID", "E-mail", "email", "Team ID", "notes"], usersTable.columns);
    expect(matches).toEqual({
      ID: "id",
      "E-mail": "email",
      email: "",
      "Team ID": "team_id",
      notes: "",
    });
    expect(toMapping(["ID", "E-mail", "email", "Team ID", "notes"], matches)).toEqual([
      { source: "ID", column: "id" },
      { source: "E-mail", column: "email" },
      { source: "Team ID", column: "team_id" },
    ]);
  });

  it("moves a table column to the file column that takes it", () => {
    expect(withMatch({ a: "email", b: "" }, "b", "email")).toEqual({ a: "", b: "email" });
    expect(withMatch({ a: "", b: "" }, "a", "")).toEqual({ a: "", b: "" });
  });

  it("keys sample rows apart even when two are the same", () => {
    const keys = sampleRows([["a"], ["a"], [null], ["b"]], 3).map((row) => row.key);
    expect(new Set(keys).size).toBe(3);
    expect(keys).toHaveLength(3);
  });

  it("measures progress by the bytes read", () => {
    expect(importedShare({ rows: 10, bytesRead: 50, bytesTotal: 200 })).toBe(0.25);
    expect(importedShare({ rows: 0, bytesRead: 0, bytesTotal: 0 })).toBe(0);
  });
});
