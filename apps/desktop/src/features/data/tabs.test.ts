import { describe, expect, it } from "vitest";

import { tabFromKey, tableTab } from "./tabs";
import { nextQueryTab } from "./workspace-store";

describe("tabs", () => {
  it("rebuilds every kind of tab from its key", () => {
    expect(tabFromKey("table:auth.users")).toEqual({
      key: "table:auth.users",
      kind: "table",
      title: "users",
    });
    expect(tabFromKey("query:3")?.title).toBe("Query 3");
    expect(tabFromKey("diagram")?.kind).toBe("diagram");
    expect(tabFromKey("history")?.kind).toBe("history");
    expect(tabFromKey("keys")?.kind).toBe("keys");
    expect(tabFromKey("table:")).toBeUndefined();
    expect(tabFromKey("nonsense")).toBeUndefined();
  });

  it("names table tabs after the table", () => {
    expect(tableTab("public.orders").title).toBe("orders");
  });

  it("numbers query tabs from the first free one", () => {
    expect(nextQueryTab([{ key: "query:1", kind: "query", title: "Query 1" }]).key).toBe("query:2");
    expect(nextQueryTab([]).title).toBe("Query 1");
  });
});
