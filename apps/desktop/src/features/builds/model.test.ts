import { describe, expect, it } from "vitest";

import { buildFixture } from "@/test/fixtures";

import {
  buildName,
  buildProgress,
  buildTileState,
  cachedLabel,
  elapsed,
  formatDuration,
  runningCount,
  sortBuilds,
} from "./model";

describe("sortBuilds", () => {
  it("puts running builds first, then the newest", () => {
    const old = buildFixture({ id: "old", startedAtMs: 1000 });
    const recent = buildFixture({ id: "recent", startedAtMs: 3000 });
    const running = buildFixture({ id: "running", status: "running", startedAtMs: 2000 });
    expect(sortBuilds([old, running, recent]).map((build) => build.id)).toEqual([
      "running",
      "recent",
      "old",
    ]);
    expect(runningCount([old, running, recent])).toBe(1);
    expect(runningCount(undefined)).toBe(0);
  });
});

describe("formatDuration", () => {
  it("reads like a stopwatch", () => {
    expect(formatDuration(148)).toBe("0.1s");
    expect(formatDuration(5230)).toBe("5.2s");
    expect(formatDuration(42_900)).toBe("42s");
    expect(formatDuration(64_000)).toBe("1m 4s");
    expect(formatDuration(7_500_000)).toBe("2h 5m");
  });

  it("counts a running build up to now", () => {
    const running = buildFixture({ status: "running", startedAtMs: 1000, completedAtMs: null });
    expect(elapsed(running, 4000)).toBe(3000);
  });
});

describe("step counts", () => {
  it("says how much came from the cache once BuildKit has counted", () => {
    const done = buildFixture({ totalSteps: 10, completedSteps: 10, cachedSteps: 4 });
    expect(cachedLabel(done)).toBe("4 of 10 cached");
    expect(buildProgress(done)).toBe(1);
    const running = buildFixture({ status: "running", totalSteps: 0, completedSteps: 0 });
    expect(cachedLabel(running)).toBeNull();
    expect(buildProgress(running)).toBeUndefined();
  });

  it("marks only a failed build's tile", () => {
    expect(buildTileState(buildFixture({ status: "failed" }))).toBe("bad");
    expect(buildTileState(buildFixture({ status: "canceled" }))).toBe("off");
    expect(buildTileState(buildFixture({ status: "running" }))).toBe("on");
  });

  it("names an unnamed build by its id", () => {
    expect(buildName({ id: "vz73j982nfapcjly5dsdomi65", name: "" })).toBe("Build vz73j98");
    expect(buildName({ id: "x", name: "shop (api)" })).toBe("shop (api)");
  });
});
