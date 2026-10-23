import { describe, expect, it } from "vitest";

import { engineFixture, preferencesFixture } from "@/test/fixtures";

import { describeChanges, linesOf, sizeOutOfDate, withNotification } from "./model";

const saved = engineFixture().config;

describe("describeChanges", () => {
  it("says nothing when nothing changed", () => {
    expect(describeChanges(saved, saved)).toEqual([]);
  });

  it("names each change in words", () => {
    const draft = {
      ...saved,
      cpus: 6,
      memoryGib: 12,
      rosetta: false,
      vmType: "krunkit" as const,
      kubernetes: { ...saved.kubernetes, enabled: true },
      registryMirrors: ["https://mirror.gcr.io"],
    };
    expect(describeChanges(saved, draft)).toEqual([
      "CPUs 4 → 6",
      "memory 8 → 12 GB",
      "Rosetta off",
      "Kubernetes on",
      "virtualization krunkit",
      "registries",
    ]);
  });
});

describe("sizeOutOfDate", () => {
  it("compares the running VM with the saved size", () => {
    const instance = {
      status: "running" as const,
      arch: "aarch64",
      cpus: 4,
      memoryBytes: 8 * 1024 ** 3,
      diskBytes: 0,
      address: null,
    };
    expect(sizeOutOfDate(engineFixture({ instance }))).toBe(false);
    expect(sizeOutOfDate(engineFixture({ instance: { ...instance, cpus: 2 } }))).toBe(true);
    expect(
      sizeOutOfDate(engineFixture({ phase: "stopped", instance: { ...instance, cpus: 2 } })),
    ).toBe(false);
    expect(sizeOutOfDate(undefined)).toBe(false);
  });
});

describe("linesOf", () => {
  it("keeps one trimmed entry per line", () => {
    expect(linesOf(" https://a.example \n\nlocalhost:5000\n")).toEqual([
      "https://a.example",
      "localhost:5000",
    ]);
  });
});

describe("withNotification", () => {
  it("switches one kind on or off and lists it once", () => {
    const off = withNotification(preferencesFixture(), "crash", false);
    expect(off.notifyOn).toEqual(["unhealthy", "finished", "lowMemory"]);
    expect(withNotification(off, "crash", true).notifyOn).toContain("crash");
    expect(withNotification(off, "unhealthy", true).notifyOn).toEqual(off.notifyOn);
  });
});
