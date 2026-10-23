import { describe, expect, it } from "vitest";

import type { Column } from "@/lib/ipc/bindings";

import {
  cellText,
  compactCount,
  EMPTY_PENDING,
  keyCells,
  parseConnectionUrl,
  pendingCount,
  pendingSummary,
  tableKey,
  toChangeSet,
  uniqueFilters,
  whereText,
  withDeleteToggled,
  withEdit,
  withRowsDeleted,
} from "./model";

function column(name: string, primaryKey = false): Column {
  return {
    name,
    typeName: "text",
    kind: "text",
    nullable: true,
    primaryKey,
    references: null,
    default: null,
  };
}

const columns = [column("id", true), column("email"), column("credit")];
const table = { schema: "public", name: "customers" };

describe("tableKey", () => {
  it("qualifies with the schema when there is one", () => {
    expect(tableKey(table)).toBe("public.customers");
    expect(tableKey({ schema: null, name: "notes" })).toBe("notes");
  });
});

describe("cellText", () => {
  it("writes every value the way an edit starts from it", () => {
    expect(cellText(null)).toBeNull();
    expect(cellText(12.5)).toBe("12.5");
    expect(cellText(true)).toBe("true");
    expect(cellText({ a: 1 })).toBe('{"a":1}');
  });
});

describe("pending changes", () => {
  const key = keyCells([7, "ada@example.com", null], columns);

  /** One edited cell, one added row and one deleted row. */
  function staged() {
    if (!key) {
      throw new Error("expected a key");
    }
    const edited = withEdit(EMPTY_PENDING, key, "credit", null, "12.50");
    return withDeleteToggled({ ...edited, added: [{ email: "new@example.com", credit: "" }] }, [
      { column: "id", value: "9" },
    ]);
  }

  it("finds a row by its primary key", () => {
    expect(key).toEqual([{ column: "id", value: "7" }]);
    expect(keyCells(["x"], [column("name")])).toBeNull();
  });

  it("drops an edit that returns a cell to its old value", () => {
    if (!key) {
      throw new Error("expected a key");
    }
    const edited = withEdit(EMPTY_PENDING, key, "email", "ada@example.com", "ada@example.org");
    expect(pendingCount(edited)).toBe(1);
    const again = withEdit(edited, key, "email", "ada@example.org", "ada@example.com");
    expect(pendingCount(again)).toBe(0);
  });

  it("remembers a NULL original through later edits", () => {
    if (!key) {
      throw new Error("expected a key");
    }
    const edited = withEdit(EMPTY_PENDING, key, "credit", null, "1");
    const again = withEdit(edited, key, "credit", "1", "2");
    expect(again.edits['["7"]']?.set.credit?.before).toBeNull();
    expect(pendingCount(withEdit(again, key, "credit", "2", null))).toBe(0);
  });

  it("builds the change set the commit sends", () => {
    expect(toChangeSet(staged(), table)).toEqual({
      table,
      updates: [{ key, set: [{ column: "credit", value: "12.50" }] }],
      inserts: [[{ column: "email", value: "new@example.com" }]],
      deletes: [[{ column: "id", value: "9" }]],
    });
  });

  it("sums up what is staged", () => {
    expect(pendingSummary(staged())).toBe("1 edited · 1 added · 1 deleted");
  });

  it("unmarks a row deleted twice", () => {
    expect(pendingCount(withDeleteToggled(staged(), [{ column: "id", value: "9" }]))).toBe(2);
  });
});

describe("withRowsDeleted", () => {
  it("drops added rows and toggles the rest", () => {
    const pending = { ...EMPTY_PENDING, added: [{ email: "a" }, { email: "b" }, { email: "c" }] };
    const next = withRowsDeleted(pending, [
      { added: 0, key: null },
      { added: 2, key: null },
      { added: null, key: [{ column: "id", value: "7" }] },
    ]);
    expect(next.added).toEqual([{ email: "b" }]);
    expect(Object.keys(next.deleted)).toEqual(['["7"]']);
  });
});

describe("uniqueFilters", () => {
  it("drops a filter added twice and keeps ones that differ", () => {
    const equals = { column: "email", op: "equals" as const, value: "x" };
    const isNull = { column: "email", op: "isNull" as const, value: null };
    expect(uniqueFilters([equals, isNull, { ...equals }])).toEqual([equals, isNull]);
  });
});

describe("whereText", () => {
  it("reads filters as SQL", () => {
    expect(
      whereText([
        { column: "status", op: "equals", value: "paid" },
        { column: "paid_at", op: "isNull", value: null },
      ]),
    ).toBe("status = 'paid' and paid_at is null");
  });
});

describe("parseConnectionUrl", () => {
  it("fills the form from a Postgres URL", () => {
    expect(
      parseConnectionUrl(
        "postgres://neondb_owner:p%40ss@ep-cool.eu-central-1.aws.neon.tech:5432/billing?sslmode=require",
      ),
    ).toEqual({
      engine: "postgres",
      host: "ep-cool.eu-central-1.aws.neon.tech",
      port: 5432,
      user: "neondb_owner",
      password: "p@ss",
      database: "billing",
      tls: true,
      name: "ep-cool",
    });
  });

  it("keeps a stray percent sign in the password and database as typed", () => {
    expect(parseConnectionUrl("postgres://app:50%off@db.example.com/sales%")).toMatchObject({
      password: "50%off",
      database: "sales%",
    });
  });

  it("knows the other schemes and rejects text that isn't a URL", () => {
    expect(parseConnectionUrl("mongodb://localhost:27017")?.engine).toBe("mongodb");
    expect(parseConnectionUrl("rediss://cache.example.com")?.tls).toBe(true);
    expect(parseConnectionUrl("ftp://example.com")).toBeNull();
    expect(parseConnectionUrl("not a url")).toBeNull();
  });
});

describe("compactCount", () => {
  it("shortens large counts", () => {
    expect(compactCount(182_400_311)).toBe("182.4M");
    expect(compactCount(41_022)).toBe("41k");
    expect(compactCount(2140)).toBe("2,140");
    expect(compactCount(null)).toBe("");
  });
});
