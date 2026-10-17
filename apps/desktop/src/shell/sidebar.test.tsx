import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { containerFixture, engineFixture, metricsFixture } from "@/test/fixtures";
import { mockCommands, renderWithApp } from "@/test/harness";

import { Sidebar } from "./sidebar";

function renderSidebar(phase: "running" | "stopped" = "running") {
  const calls = mockCommands({
    engineStatus: () => engineFixture({ phase }),
    dataConnections: () => [],
    containersList: () => [
      containerFixture({ id: "a", name: "api" }),
      containerFixture({ id: "b", name: "worker", state: "exited", status: "Exited (2) now" }),
    ],
    metricsLatest: () =>
      metricsFixture({
        ledger: { totalBytes: 8 * 1024 ** 3, usedBytes: 512 * 1024 ** 2, segments: [] },
      }),
  });
  renderWithApp(<Sidebar />);
  return calls;
}

describe("Sidebar", () => {
  it("counts running containers and flags a crash", async () => {
    renderSidebar();
    const containers = await screen.findByRole("link", { name: /Containers/ });
    await waitFor(() => expect(containers.textContent).toContain("1"));
    expect(screen.getByLabelText("1 crashed")).toBeDefined();
  });

  it("shows engine memory in the footer", async () => {
    renderSidebar();
    expect(await screen.findByText("512 MB of 8 GB")).toBeDefined();
  });

  it("stops the engine from the engine menu", async () => {
    const calls = renderSidebar();
    await userEvent.click(await screen.findByRole("button", { name: /Containeria Running/ }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Stop engine" }));
    await waitFor(() => expect(calls.map((call) => call.command)).toContain("engineStop"));
  });

  it("starts a stopped engine from the same menu", async () => {
    const calls = renderSidebar("stopped");
    await userEvent.click(await screen.findByRole("button", { name: /Containeria Stopped/ }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Start engine" }));
    await waitFor(() => expect(calls.map((call) => call.command)).toContain("engineStart"));
  });
});
