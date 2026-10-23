import { describe, expect, it } from "vitest";

import type { StatsSample } from "@/lib/ipc/bindings";

import { appendSample, emptyHistory, HISTORY } from "./stats-model";

const sample = (overrides: Partial<StatsSample> = {}): StatsSample => ({
  cpuPercent: 12,
  memoryBytes: 1000,
  memoryLimitBytes: 0,
  networkRxBytes: 0,
  networkTxBytes: 0,
  diskReadBytes: 0,
  diskWriteBytes: 0,
  ...overrides,
});

describe("appendSample", () => {
  it("turns cumulative counters into per-second rates", () => {
    const first = appendSample(
      emptyHistory,
      sample({ networkRxBytes: 1000, diskWriteBytes: 50 }),
      100,
    );
    const second = appendSample(first, sample({ networkRxBytes: 5000, diskWriteBytes: 250 }), 102);
    expect(second.received).toEqual([0, 2000]);
    expect(second.written).toEqual([0, 100]);
    expect(second.times).toEqual([100, 102]);
  });

  it("reads a counter reset as zero instead of a negative rate", () => {
    const first = appendSample(emptyHistory, sample({ networkTxBytes: 900 }), 1);
    expect(appendSample(first, sample({ networkTxBytes: 10 }), 2).sent).toEqual([0, 0]);
  });

  it("keeps only the latest readings and treats missing CPU as idle", () => {
    let history = emptyHistory;
    for (let second = 0; second < HISTORY + 5; second += 1) {
      history = appendSample(history, sample({ cpuPercent: null }), second);
    }
    expect(history.times).toHaveLength(HISTORY);
    expect(history.times[0]).toBe(5);
    expect(history.cpu.every((value) => value === 0)).toBe(true);
  });
});
