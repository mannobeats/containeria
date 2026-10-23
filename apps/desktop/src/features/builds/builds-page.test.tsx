import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import type { BuildRecord } from "@/lib/ipc/bindings";
import { buildFixture, engineFixture } from "@/test/fixtures";
import { mockCommands, renderWithApp } from "@/test/harness";

import { BuildsPage } from "./builds-page";

const done = buildFixture({
  id: "done1",
  name: "shop (api)",
  startedAtMs: 3000,
  completedAtMs: 8200,
});
const failed = buildFixture({
  id: "fail1",
  name: "worker",
  status: "failed",
  startedAtMs: 2000,
  cachedSteps: 1,
  totalSteps: 5,
});
const running = buildFixture({
  id: "run1",
  name: "web",
  status: "running",
  startedAtMs: 1000,
  completedAtMs: null,
  totalSteps: 0,
  completedSteps: 0,
  cachedSteps: 0,
});

function setup(builds: BuildRecord[] = [done, failed, running]) {
  const calls = mockCommands({
    engineStatus: () => engineFixture(),
    buildsList: () => builds,
  });
  renderWithApp(<BuildsPage />);
  return calls;
}

describe("BuildsPage", () => {
  it("lists running builds first with their progress, then the newest", async () => {
    setup();
    const table = await screen.findByRole("table", { name: "Builds" });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((row) => within(row).getByRole("link").textContent)).toEqual([
      "web",
      "shop (api)",
      "worker",
    ]);
    expect(within(rows[0] as HTMLElement).getByRole("progressbar", { name: "web progress" }));
    expect(within(rows[0] as HTMLElement).getByText("Building")).toBeDefined();
    expect(within(rows[1] as HTMLElement).getByText("4 of 10 cached")).toBeDefined();
    expect(within(rows[1] as HTMLElement).getByText("5.2s")).toBeDefined();
    expect(within(rows[2] as HTMLElement).getByText("Failed")).toBeDefined();
    expect(screen.getByText(/1 build running/)).toBeDefined();
  });

  it("removes a finished build from the history from its menu", async () => {
    const calls = setup();
    await userEvent.click(await screen.findByRole("button", { name: "More for shop (api)" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Remove from History" }));
    await waitFor(() =>
      expect(calls).toContainEqual({ command: "buildRemove", args: { id: "done1" } }),
    );
  });

  it("keeps a running build in the history", async () => {
    setup();
    await userEvent.click(await screen.findByRole("button", { name: "More for web" }));
    const remove = await screen.findByRole("menuitem", { name: "Remove from History" });
    expect(remove.getAttribute("data-disabled")).not.toBeNull();
  });

  it("clears the history after confirming", async () => {
    const calls = setup();
    await userEvent.click(await screen.findByRole("button", { name: "Clear History…" }));
    await userEvent.click(await screen.findByRole("button", { name: "Clear History" }));
    await waitFor(() => expect(calls.map((call) => call.command)).toContain("buildsClear"));
  });

  it("explains where builds come from and opens the build sheet", async () => {
    setup([]);
    expect(await screen.findByText("No builds yet")).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: "Build Image…" }));
    expect(await screen.findByRole("dialog", { name: "Build an image" })).toBeDefined();
  });
});
