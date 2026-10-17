import { cleanup } from "@testing-library/react";
import { MotionGlobalConfig } from "motion/react";
import { afterEach, vi } from "vitest";

import { FakeFitAddon, FakePlot, FakeTerminal, plots, terminals } from "./canvas-mocks";

// Animations jump to their end: happy-dom rejects an unfinished one with an AbortError on unmount.
MotionGlobalConfig.skipAnimations = true;

vi.mock("uplot", () => ({ default: FakePlot }));
vi.mock("@xterm/xterm", () => ({ Terminal: FakeTerminal }));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: FakeFitAddon }));

afterEach(() => {
  cleanup();
  plots.length = 0;
  terminals.length = 0;
});
