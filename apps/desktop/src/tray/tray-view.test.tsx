import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

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
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("sizes its window to the content", async () => {
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(412);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        readonly #report: () => void;
        constructor(report: () => void) {
          this.#report = report;
        }
        observe() {
          this.#report();
        }
        disconnect() {
          return undefined;
        }
      },
    );
    const calls = renderTray("running");
    await waitFor(() =>
      expect(calls).toContainEqual({ command: "windowFit", args: { height: 412 } }),
    );
  });

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

  it("restarts a container from its right-click menu", async () => {
    const calls = renderTray("running");
    fireEvent.contextMenu(await screen.findByText("shop-db-1"));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Restart" }));
    await waitFor(() =>
      expect(calls).toContainEqual({
        command: "containerAct",
        args: { id: "db", action: "restart" },
      }),
    );
  });

  it("opens a container's menu from its ⋯ button", async () => {
    const calls = renderTray("running");
    await userEvent.click(await screen.findByRole("button", { name: "More for shop-db-1" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Restart" }));
    await waitFor(() =>
      expect(calls).toContainEqual({
        command: "containerAct",
        args: { id: "db", action: "restart" },
      }),
    );
  });

  it("can't start an engine Colima isn't installed for", async () => {
    renderTray("missing");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Start" }).hasAttribute("disabled")).toBe(true),
    );
  });

  it("starts a stopped engine", async () => {
    const calls = renderTray("stopped");
    await userEvent.click(await screen.findByRole("button", { name: "Start" }));
    await waitFor(() => expect(names(calls)).toContain("engineStart"));
  });

  it("closes on Escape, as a popover does", async () => {
    const calls = renderTray("running");
    await screen.findByText("Engine running · 1 container");
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(names(calls)).toContain("windowHide"));
  });

  it("offers to take the Docker context back from another engine", async () => {
    const calls = mockCommands({
      engineStatus: () =>
        engineFixture({
          dockerContext: { name: "colima", endpoint: "unix:///tmp/colima.sock", answers: false },
        }),
    });
    renderWithApp(<TrayView />);
    expect(await screen.findByText("colima")).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: "Use Containeria" }));
    await waitFor(() =>
      expect(calls).toContainEqual({ command: "engineUseDockerContext", args: {} }),
    );
  });

  it("opens the main window", async () => {
    const calls = renderTray("running");
    await userEvent.click(await screen.findByRole("button", { name: "Open Containeria" }));
    await waitFor(() => expect(calls).toContainEqual({ command: "windowShowMain", args: {} }));
  });

  it("opens Settings at General", async () => {
    const calls = renderTray("running");
    await userEvent.click(await screen.findByRole("button", { name: "Settings…" }));
    await waitFor(() =>
      expect(calls).toContainEqual({ command: "settingsOpen", args: { pane: "general" } }),
    );
  });

  it("quits", async () => {
    const calls = renderTray("running");
    await userEvent.click(await screen.findByRole("button", { name: "Quit Containeria" }));
    await waitFor(() => expect(calls).toContainEqual({ command: "appQuit", args: {} }));
  });
});
