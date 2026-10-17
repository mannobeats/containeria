import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

import { FakeFitAddon, FakePlot, FakeTerminal, plots, terminals } from "./canvas-mocks";

vi.mock("uplot", () => ({ default: FakePlot }));
vi.mock("@xterm/xterm", () => ({ Terminal: FakeTerminal }));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: FakeFitAddon }));

afterEach(() => {
  cleanup();
  plots.length = 0;
  terminals.length = 0;
});
