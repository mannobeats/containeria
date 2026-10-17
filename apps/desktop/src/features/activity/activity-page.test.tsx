import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { EnginePhase } from "@/lib/ipc/bindings";
import { containerFixture, engineFixture, metricsFixture } from "@/test/fixtures";
import { mockCommands, renderWithApp } from "@/test/harness";

import { ActivityPage } from "./activity-page";

vi.mock("@/ui/chart", () => ({
  Chart: ({ label, series }: { label: string; series: { label: string }[] }) => (
    <figure aria-label={label}>{series.map((line) => line.label).join(", ")}</figure>
  ),
}));

const MIB = 1024 ** 2;
const shop = { id: "project:shop", label: "shop", kind: "project" as const, bytes: 300 * MIB };

function renderActivity(phase: EnginePhase) {
  mockCommands({
    engineStatus: () => engineFixture({ phase }),
    containersList: () => [
      containerFixture({ id: "db", name: "shop-db-1", image: "postgres:18", project: "shop" }),
    ],
    metricsLatest: () =>
      metricsFixture({
        containers: [{ id: "db", cpuPercent: 3.2, memoryBytes: 300 * MIB }],
        ledger: { totalBytes: 8 * 1024 ** 3, usedBytes: 300 * MIB, segments: [shop] },
      }),
    metricsHistory: () => [
      { sampledAtMs: 1000, cpuPercent: 3.2, usedBytes: 300 * MIB, segments: [shop] },
    ],
  });
  renderWithApp(<ActivityPage />);
}

describe("ActivityPage", () => {
  it("shows memory in use, the charts and what uses it most", async () => {
    renderActivity("running");
    expect(await screen.findByText("in use of 8 GB")).toBeDefined();
    expect(screen.getByText(/Apple Virtualization keeps memory/)).toBeDefined();
    expect(
      await screen.findByRole("figure", { name: "Engine memory over time by project" }),
    ).toBeDefined();
    expect(
      screen.getByRole("figure", { name: "Engine memory over time by project" }).textContent,
    ).toBe("Total, shop");
    expect(await screen.findByRole("link", { name: /shop-db-1/ })).toBeDefined();
  });

  it("explains there's nothing to measure while the engine is stopped", async () => {
    renderActivity("stopped");
    expect(await screen.findByRole("heading", { name: "Nothing to measure yet" })).toBeDefined();
  });

  it("says where the numbers come from on another engine", async () => {
    renderActivity("external");
    expect(await screen.findByText(/CONTAINERIA_DOCKER_SOCKET/)).toBeDefined();
  });
});
