import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import type { EnginePhase } from "@/lib/ipc/bindings";
import { containerFixture, engineFixture, metricsFixture } from "@/test/fixtures";
import { mockCommands, renderWithApp } from "@/test/harness";

import { TrayView } from "./tray-view";

function renderTray(phase: EnginePhase) {
  const calls = mockCommands({
    engineStatus: () => engineFixture({ phase }),
    containersList: () => [
      containerFixture({ id: "db", name: "shop-db-1", image: "postgres:18" }),
      containerFixture({ id: "old", name: "old-job", state: "exited", status: "Exited (0) now" }),
    ],
    metricsLatest: () =>
      metricsFixture({ containers: [{ id: "db", cpuPercent: 1, memoryBytes: 64 * 1024 ** 2 }] }),
  });
  renderWithApp(<TrayView />);
  return calls;
}

const names = (calls: { command: string }[]) => calls.map((call) => call.command);

describe("TrayView", () => {
  it("lists what runs and stops a container", async () => {
    const calls = renderTray("running");
    expect(await screen.findByText("Engine running · 1 container")).toBeDefined();
    expect(screen.queryByText("old-job")).toBeNull();
    expect(screen.getByText("64 MB")).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: "Stop shop-db-1" }));
    await waitFor(() =>
      expect(calls).toContainEqual({ command: "containerAct", args: { id: "db", action: "stop" } }),
    );
  });

  it("starts a stopped engine", async () => {
    const calls = renderTray("stopped");
    await userEvent.click(await screen.findByRole("button", { name: "Start" }));
    await waitFor(() => expect(names(calls)).toContain("engineStart"));
  });

  it("opens the window and quits", async () => {
    const calls = renderTray("running");
    await userEvent.click(await screen.findByRole("button", { name: "Open Containeria" }));
    await userEvent.click(screen.getByRole("button", { name: "Quit Containeria" }));
    await waitFor(() =>
      expect(names(calls)).toEqual(expect.arrayContaining(["windowShowMain", "appQuit"])),
    );
  });
});
