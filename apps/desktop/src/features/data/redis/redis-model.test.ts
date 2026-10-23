import { describe, expect, it } from "vitest";

import { pretty, ttlText } from "./redis-model";

describe("redis values", () => {
  it("reads a time to live", () => {
    expect(ttlText(null)).toBe("");
    expect(ttlText(42)).toBe("42s");
    expect(ttlText(900)).toBe("15m");
    expect(ttlText(10_800)).toBe("3h");
  });

  it("formats JSON and leaves other text alone", () => {
    expect(pretty('{"a":1}')).toBe('{\n  "a": 1\n}');
    expect(pretty("hello")).toBe("hello");
  });
});
