import { describe, expect, it } from "vitest";

import { chartData, resolveColor, tooltipRows } from "./time-chart-model";

const series = [
  { label: "CPU", color: "var(--s1)", values: [1, null] },
  { label: "Memory", color: "var(--s2)", values: [3, 4] },
];

describe("chartData", () => {
  it("puts seconds first, then one column per series", () => {
    expect(chartData([1000, 3000], series)).toEqual([
      [1, 3],
      [1, null],
      [3, 4],
    ]);
  });
});

describe("tooltipRows", () => {
  it("formats each series at a sample and marks gaps", () => {
    expect(tooltipRows(series, 1, (value) => `${value}%`)).toEqual(["CPU  —", "Memory  4%"]);
  });
});

describe("resolveColor", () => {
  it("returns a colour canvas can use and leaves no probe behind", () => {
    expect(resolveColor("rgb(1, 2, 3)")).toBe("rgb(1, 2, 3)");
    expect(document.body.children).toHaveLength(0);
  });
});
