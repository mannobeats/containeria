import { describe, expect, it } from "vitest";

import { machineFixture } from "./fixtures";
import {
  cpuPercent,
  kindLabel,
  limitLabel,
  nameProblem,
  stateLabel,
  suggestName,
  withCpu,
} from "./model";

describe("labels", () => {
  it("names states and kinds the way people say them", () => {
    expect(stateLabel(machineFixture({ state: "frozen" }))).toBe("Paused");
    expect(stateLabel(machineFixture({ state: "busy" }))).toBe("Working…");
    expect(kindLabel({ kind: "vm" })).toBe("Full VM");
    expect(kindLabel({ kind: "container" })).toBe("System container");
  });

  it("reads Incus memory limits", () => {
    expect(limitLabel("4GiB")).toBe("4 GB");
    expect(limitLabel("512MiB")).toBe("512 MB");
    expect(limitLabel(null)).toBeNull();
  });
});

describe("suggestName", () => {
  it("picks the distro's name, then numbers it", () => {
    expect(suggestName("ubuntu", [])).toBe("ubuntu");
    expect(suggestName("ubuntu", ["ubuntu", "ubuntu-2"])).toBe("ubuntu-3");
    expect(suggestName("archlinux", [])).toBe("arch");
  });
});

describe("nameProblem", () => {
  it("accepts host names and explains the rest", () => {
    expect(nameProblem("dev-2", [])).toBeNull();
    expect(nameProblem("", [])).toBe("Give the machine a name.");
    expect(nameProblem("dev", ["dev"])).toBe("A machine with this name exists.");
    expect(nameProblem("2dev", [])).toBe("Start the name with a lowercase letter.");
    expect(nameProblem("dev box", [])).toBe("Use lowercase letters, numbers and dashes.");
    expect(nameProblem("dev-", [])).toBe("Use lowercase letters, numbers and dashes.");
  });
});

describe("cpuPercent", () => {
  it("divides CPU time by wall time", () => {
    expect(cpuPercent({ cpuSeconds: 10, at: 0 }, { cpuSeconds: 11.5, at: 3000 })).toBe(50);
  });

  it("needs two readings", () => {
    expect(cpuPercent(undefined, { cpuSeconds: 1, at: 0 })).toBeNull();
    expect(cpuPercent({ cpuSeconds: null, at: 0 }, { cpuSeconds: 1, at: 1000 })).toBeNull();
    expect(cpuPercent({ cpuSeconds: 1, at: 1000 }, { cpuSeconds: 2, at: 1000 })).toBeNull();
  });
});

describe("withCpu", () => {
  it("compares each machine with its previous reading", () => {
    const first = withCpu(undefined, [machineFixture({ cpuSeconds: 10 })], 0);
    expect(first.machines[0]?.cpuPercent).toBeNull();
    const second = withCpu(
      first,
      [machineFixture({ cpuSeconds: 10.3 }), machineFixture({ name: "new", cpuSeconds: 1 })],
      3000,
    );
    expect(second.machines[0]?.cpuPercent).toBeCloseTo(10);
    expect(second.machines[1]?.cpuPercent).toBeNull();
  });
});
