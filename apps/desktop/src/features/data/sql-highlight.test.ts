import { describe, expect, it } from "vitest";

import { highlightSql } from "./sql-highlight";

describe("highlightSql", () => {
  it("colours keywords, strings and numbers and keeps every character", () => {
    const sql = "select id from orders\nwhere status = 'paid' limit 10";
    const spans = highlightSql(sql);
    expect(spans.map((span) => span.text).join("")).toBe(sql);
    expect(spans.find((span) => span.text === "select")?.className).toBe("text-sx-kw");
    expect(spans.find((span) => span.text === "'paid'")?.className).toBe("text-sx-str");
    expect(spans.find((span) => span.text === "10")?.className).toBe("text-sx-num");
    expect(new Set(spans.map((span) => span.from)).size).toBe(spans.length);
  });
});
