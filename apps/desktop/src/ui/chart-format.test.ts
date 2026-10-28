import { beforeEach, describe, expect, it } from "vitest";

import { useClock } from "@/lib/clock";

import { readout, timeTicks } from "./chart-format";

const at = (iso: string) => Date.parse(iso) / 1000;

beforeEach(() => useClock.setState({ timeZone: undefined, hour12: false }));

describe("timeTicks", () => {
  it("shows seconds when the span is under ten minutes", () => {
    const ticks = timeTicks([at("2026-10-17T05:46:10"), at("2026-10-17T05:56:09")]);
    expect(ticks[0]).toMatch(/^\d\d:\d\d:\d\d$/);
  });

  it("shows minutes once the span reaches ten minutes", () => {
    const ticks = timeTicks([at("2026-10-17T05:46:10"), at("2026-10-17T05:56:10")]);
    expect(ticks[0]).toMatch(/^\d\d:\d\d$/);
  });
});

describe("readout", () => {
  const rows = [
    { label: "CPU", value: null },
    { label: "Memory", value: 4 },
  ];
  const text = () => readout(at("2026-10-17T05:46:10"), rows, (value) => `${value}%`).split("\n");

  it("starts with the time to the second", () => {
    expect(text()[0]).toMatch(/^\d\d:\d\d:\d\d$/);
  });

  it("prints a dash for a series with a gap", () => {
    expect(text()[1]).toBe("CPU  —");
  });

  it("prints a series' value in its format", () => {
    expect(text()[2]).toBe("Memory  4%");
  });
});
