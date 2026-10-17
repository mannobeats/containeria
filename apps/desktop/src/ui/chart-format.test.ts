import { describe, expect, it } from "vitest";

import { readout, timeTicks } from "./chart-format";

const at = (iso: string) => Date.parse(iso) / 1000;

describe("timeTicks", () => {
  it("shows seconds on short spans and minutes on long ones", () => {
    const short = timeTicks([at("2026-10-17T05:46:10"), at("2026-10-17T05:46:40")]);
    expect(short[0]).toMatch(/^\d\d:\d\d:\d\d$/);
    const long = timeTicks([at("2026-10-17T05:00:00"), at("2026-10-17T05:30:00")]);
    expect(long[0]).toMatch(/^\d\d:\d\d$/);
  });
});

describe("readout", () => {
  it("formats each series and marks gaps", () => {
    const text = readout(
      at("2026-10-17T05:46:10"),
      [
        { label: "CPU", value: null },
        { label: "Memory", value: 4 },
      ],
      (value) => `${value}%`,
    );
    expect(text.split("\n").slice(1)).toEqual(["CPU  —", "Memory  4%"]);
  });
});
