import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { engineFixture, volumeFixture } from "@/test/fixtures";
import { mockCommands, renderWithApp } from "@/test/harness";

import { VolumesPage } from "./volumes-page";

const pgdata = volumeFixture({
  name: "shop_pgdata",
  sizeBytes: 300_000_000,
  usedBy: [
    {
      containerId: "db",
      container: "shop-db-1",
      mountedAt: "/var/lib/postgresql/data",
      running: true,
    },
  ],
});
const cache = volumeFixture({ name: "old_cache", project: null, sizeBytes: 100_000_000 });

function setup(volumes = [pgdata, cache]) {
  const calls = mockCommands({
    engineStatus: () => engineFixture(),
    volumesList: () => volumes,
    volumesPrune: () => ({ removed: 1, reclaimedBytes: 100_000_000 }),
  });
  renderWithApp(<VolumesPage />);
  return calls;
}

describe("VolumesPage", () => {
  it("sums sizes and calls out unattached volumes", async () => {
    setup();
    expect(await screen.findByText("old_cache")).toBeDefined();
    expect(screen.getByText(/in 2 volumes/).textContent).toContain("400 MB");
    expect(screen.getByText(/aren't attached/).textContent).toContain("100 MB");
    expect(screen.getByText("/var/lib/postgresql/data")).toBeDefined();
  });

  it("filters to unattached volumes", async () => {
    setup();
    await screen.findByText("old_cache");
    await userEvent.click(screen.getByRole("radio", { name: /Unattached/ }));
    expect(screen.queryByText("shop_pgdata")).toBeNull();
  });

  it("creates a volume with a valid name", async () => {
    const calls = setup();
    await userEvent.click(await screen.findByRole("button", { name: "New volume" }));
    const name = screen.getByRole("textbox", { name: "Name" });
    await userEvent.type(name, "-bad");
    expect(screen.getByRole("alert").textContent).toMatch(/letters/);
    await userEvent.clear(name);
    await userEvent.type(name, "shop_uploads");
    await userEvent.click(screen.getByRole("button", { name: "Create volume" }));
    await waitFor(() =>
      expect(calls).toContainEqual({ command: "volumeCreate", args: { name: "shop_uploads" } }),
    );
  });

  it("clones and deletes from the row menu", async () => {
    const calls = setup();
    await userEvent.click(await screen.findByRole("button", { name: "More for old_cache" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Clone…" }));
    await userEvent.click(screen.getByRole("button", { name: "Clone volume" }));
    await waitFor(() =>
      expect(calls).toContainEqual({
        command: "volumeClone",
        args: { source: "old_cache", target: "old_cache_copy" },
      }),
    );

    await userEvent.click(screen.getByRole("button", { name: "More for old_cache" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Delete Volume…" }));
    await userEvent.click(await screen.findByRole("button", { name: "Delete volume" }));
    await waitFor(() =>
      expect(calls).toContainEqual({ command: "volumeRemove", args: { name: "old_cache" } }),
    );
  });

  it("cleans up unattached volumes", async () => {
    const calls = setup();
    await userEvent.click(await screen.findByRole("button", { name: "Clean up" }));
    await userEvent.click(await screen.findByRole("button", { name: "Delete volumes" }));
    await waitFor(() => expect(calls.map((call) => call.command)).toContain("volumesPrune"));
  });

  it("explains volumes when there are none", async () => {
    setup([]);
    expect(await screen.findByText("No volumes yet")).toBeDefined();
  });
});
