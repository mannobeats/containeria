import { describe, expect, it } from "vitest";

import {
  formatAge,
  formatBytes,
  formatMemory,
  formatPercent,
  formatRelative,
  plural,
} from "./format";

describe("formatAge", () => {
  it("shows the largest whole unit, like kubectl", () => {
    const now = 1_000_000_000_000;
    expect(formatAge(now / 1000 - 40, now)).toBe("40s");
    expect(formatAge(now / 1000 - 12 * 60, now)).toBe("12m");
    expect(formatAge(now / 1000 - 3 * 3600 - 5, now)).toBe("3h");
    expect(formatAge(now / 1000 - 6 * 86_400, now)).toBe("6d");
    expect(formatAge(now / 1000 + 30, now)).toBe("0s");
  });
});

describe("formatBytes", () => {
  it("uses decimal units with one decimal under 100", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(999)).toBe("999 B");
    expect(formatBytes(1_536_000)).toBe("1.5 MB");
    expect(formatBytes(214_000_000)).toBe("214 MB");
    expect(formatBytes(8_589_934_592)).toBe("8.6 GB");
  });
});

describe("formatMemory", () => {
  it("uses binary units like Activity Monitor", () => {
    expect(formatMemory(8 * 1024 ** 3)).toBe("8 GB");
    expect(formatMemory(56.5 * 1024 ** 2)).toBe("56.5 MB");
    expect(formatMemory(1536 * 1024 ** 2)).toBe("1.5 GB");
    expect(formatMemory(300 * 1024)).toBe("0.3 MB");
  });
});

describe("formatPercent", () => {
  it("keeps one decimal for small values", () => {
    expect(formatPercent(0.42)).toBe("0.4%");
    expect(formatPercent(12.6)).toBe("13%");
    expect(formatPercent(null)).toBe("—");
  });
});

describe("formatRelative", () => {
  it("picks the largest whole unit", () => {
    const now = 1_000_000_000_000;
    expect(formatRelative(now / 1000 - 30, now)).toBe("just now");
    expect(formatRelative(now / 1000 - 3 * 3600, now)).toBe("3 hours ago");
    expect(formatRelative(now / 1000 - 86_400, now)).toBe("yesterday");
  });
});

describe("plural", () => {
  it("adds an s unless told otherwise", () => {
    expect(plural(1, "container")).toBe("1 container");
    expect(plural(3, "container")).toBe("3 containers");
    expect(plural(2, "copy", "copies")).toBe("2 copies");
  });
});
