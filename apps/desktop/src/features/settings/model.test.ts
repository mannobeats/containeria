import { describe, expect, it } from "vitest";

import { engineFixture, preferencesFixture } from "@/test/fixtures";

import { describeChanges, linesOf, missingTools, sizeOutOfDate, withNotification } from "./model";

const saved = engineFixture().config;

describe("missingTools", () => {
  const tool = (name: string, state: "installed" | "missing" | "other") => ({
    name,
    target: `/usr/local/bin/${name}`,
    state,
  });

  it("names the tools no terminal finds", () => {
    const tools = [tool("cx", "missing"), tool("docker", "missing"), tool("kubectl", "missing")];
    expect(missingTools(tools)).toBe("cx, docker, and kubectl");
    expect(missingTools([tool("docker", "missing"), tool("kubectl", "installed")])).toBe("docker");
  });

  it("says nothing when every tool is installed or the user's own", () => {
    expect(missingTools([tool("docker", "other"), tool("cx", "installed")])).toBe("");
    expect(missingTools([])).toBe("");
  });
});

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
      sleepWhenIdle: false,
      kubernetes: { ...saved.kubernetes, enabled: true },
      registryMirrors: ["https://mirror.gcr.io"],
    };
    expect(describeChanges(saved, draft)).toEqual([
      "CPUs 4 → 6",
      "memory 8 → 12 GB",
      "Rosetta off",
      "sleep when idle off",
      "Kubernetes on",
      "registries",
    ]);
  });
});

describe("sizeOutOfDate", () => {
  it("compares the running VM with the saved size", () => {
    const vm = {
      cpus: 4,
      memory: { ceilingBytes: 8 * 1024 ** 3, allowedBytes: 2 * 1024 ** 3, usedBytes: 1024 ** 3 },
      kernel: "6.18.63",
    };
    expect(sizeOutOfDate(engineFixture({ vm }))).toBe(false);
    expect(sizeOutOfDate(engineFixture({ vm: { ...vm, cpus: 2 } }))).toBe(true);
    expect(sizeOutOfDate(engineFixture({ phase: "stopped", vm: { ...vm, cpus: 2 } }))).toBe(false);
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
