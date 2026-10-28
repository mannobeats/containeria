import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { buildFixture, containerFixture, engineFixture, metricsFixture } from "@/test/fixtures";
import { mockCommands, renderWithApp } from "@/test/harness";

import { Sidebar } from "./sidebar";

function renderSidebar(phase: "running" | "stopped" = "running") {
  const calls = mockCommands({
    engineStatus: () => engineFixture({ phase }),
    dataConnections: () => [],
    buildsList: () => [
      buildFixture({ id: "a", status: "running", completedAtMs: null }),
      buildFixture({ id: "b" }),
    ],
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

  it("counts builds while one runs", async () => {
    renderSidebar();
    const builds = await screen.findByRole("link", { name: /Builds/ });
    await waitFor(() => expect(builds.textContent).toBe("Builds1"));
  });

  it("shows engine memory in the footer", async () => {
    renderSidebar();
    expect(await screen.findByText("512 MB of 8 GB")).toBeDefined();
  });

  it("stops the engine from the engine menu", async () => {
    const calls = renderSidebar();
    await userEvent.click(await screen.findByRole("button", { name: /Containeria Running/ }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Stop Engine" }));
    await waitFor(() => expect(calls.map((call) => call.command)).toContain("engineStop"));
  });

  it("starts a stopped engine from the same menu", async () => {
    const calls = renderSidebar("stopped");
    await userEvent.click(await screen.findByRole("button", { name: /Containeria Stopped/ }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Start Engine" }));
    await waitFor(() => expect(calls.map((call) => call.command)).toContain("engineStart"));
  });

  it("can't copy the socket path before the engine reports one", async () => {
    const calls = mockCommands({
      engineStatus: () => {
        throw new Error("no engine");
      },
      dataConnections: () => [],
    });
    renderWithApp(<Sidebar />);
    await userEvent.click(
      await screen.findByRole("button", { name: /Containeria Couldn't check the engine/ }),
    );
    const copy = await screen.findByRole("menuitem", { name: "Copy Docker Socket Path" });
    expect(copy.getAttribute("aria-disabled")).toBe("true");
    await userEvent.click(copy);
    expect(calls.some((call) => String(call.command).endsWith("writeText"))).toBe(false);
  });
});
