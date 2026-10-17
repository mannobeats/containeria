import { describe, expect, it } from "vitest";

import type { MetricsPoint } from "@/lib/ipc/bindings";
import { containerFixture, metricsFixture } from "@/test/fixtures";

import { appendPoint, memorySeries, topConsumers, withinRange } from "./model";

function point(sampledAtMs: number, segments: MetricsPoint["segments"] = []): MetricsPoint {
  return {
    sampledAtMs,
    cpuPercent: 1,
    usedBytes: segments.reduce((total, segment) => total + segment.bytes, 0),
    segments,
  };
}

const shop = (bytes: number) => ({
  id: "project:shop",
  label: "shop",
  kind: "project" as const,
  bytes,
});

describe("withinRange", () => {
  it("keeps the last five or thirty minutes", () => {
    const now = 60 * 60_000;
    const points = [point(now - 20 * 60_000), point(now - 4 * 60_000), point(now)];
    expect(withinRange(points, "5m", now)).toHaveLength(2);
    expect(withinRange(points, "30m", now)).toHaveLength(3);
  });
});

describe("appendPoint", () => {
  it("adds a new sample, ignores a repeat and caps the length", () => {
    const points = [point(1), point(2)];
    expect(appendPoint(points, point(2), 10)).toBe(points);
    expect(appendPoint(points, point(3), 2).map((each) => each.sampledAtMs)).toEqual([2, 3]);
  });
});

describe("memorySeries", () => {
  it("draws the total and one line per project, zero where it wasn't running", () => {
    const series = memorySeries([point(1), point(2, [shop(100)])]);
    expect(series.map((line) => line.label)).toEqual(["Total", "shop"]);
    expect(series[1]?.values).toEqual([0, 100]);
  });
});

describe("topConsumers", () => {
  it("names containers and sorts them by memory", () => {
    const metrics = metricsFixture({
      containers: [
        { id: "a", cpuPercent: 1, memoryBytes: 10 },
        { id: "b", cpuPercent: null, memoryBytes: 30 },
        { id: "gone", cpuPercent: 1, memoryBytes: 99 },
      ],
    });
    const containers = [
      containerFixture({ id: "a", name: "api", project: "shop" }),
      containerFixture({ id: "b", name: "web", pod: "default/web" }),
    ];
    expect(
      topConsumers(metrics, containers).map((consumer) => [consumer.name, consumer.group]),
    ).toEqual([
      ["web", "Kubernetes"],
      ["api", "shop"],
    ]);
    expect(topConsumers(undefined, containers)).toEqual([]);
  });
});
