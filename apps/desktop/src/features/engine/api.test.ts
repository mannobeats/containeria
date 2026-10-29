import { describe, expect, it } from "vitest";

import type { EnginePhase } from "@/lib/ipc/bindings";

import { canControl } from "./api";

describe("canControl", () => {
  it.each<[EnginePhase | undefined, boolean]>([
    ["stopped", true],
    ["notCreated", true],
    ["broken", true],
    ["starting", false],
    ["stopping", false],
    ["running", false],
    ["external", false],
    ["missing", false],
    [undefined, false],
  ])("offers Start when the engine is %s: %s", (phase, offered) => {
    expect(canControl("start", phase)).toBe(offered);
  });
});
