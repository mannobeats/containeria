import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { engineFixture, volumeFixture } from "@/test/fixtures";
import { mockCommands, renderWithApp } from "@/test/harness";

import { volumeFromBackup } from "./model";
import { VolumesPage } from "./volumes-page";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: () => Promise.resolve("/Users/ada/Backups/shop_pgdata-2026-10-17.tar.gz"),
  save: () => Promise.resolve(null),
}));

function setup() {
  const calls = mockCommands({
    engineStatus: () => engineFixture(),
    volumesList: () => [volumeFixture({ name: "shop_pgdata" })],
  });
  renderWithApp(<VolumesPage />);
  return calls;
}

describe("restoring a volume", () => {
  it("names the volume after the backup", () => {
    expect(volumeFromBackup("/b/shop_pgdata-2026-10-17.tar.gz")).toBe("shop_pgdata");
    expect(volumeFromBackup("/b/cache.tgz")).toBe("cache");
  });

  it("restores into the volume it came from, replacing its files", async () => {
    const calls = setup();
    fireEvent.contextMenu(await screen.findByText("shop_pgdata"));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Restore from Backup…" }));
    expect(await screen.findByText("This volume exists.")).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: "Restore Into Volume" }));
    await waitFor(() =>
      expect(calls).toContainEqual(
        expect.objectContaining({
          command: "volumeRestore",
          args: {
            name: "shop_pgdata",
            source: "/Users/ada/Backups/shop_pgdata-2026-10-17.tar.gz",
            replace: true,
          },
        }),
      ),
    );
  });

  it("restores into a new volume", async () => {
    const calls = setup();
    await userEvent.click(await screen.findByRole("button", { name: "Restore…" }));
    const name = await screen.findByLabelText("Volume");
    await userEvent.clear(name);
    await userEvent.type(name, "pgdata_restored");
    await userEvent.click(screen.getByRole("button", { name: "Create and Restore" }));
    await waitFor(() =>
      expect(calls).toContainEqual(
        expect.objectContaining({
          command: "volumeRestore",
          args: expect.objectContaining({ name: "pgdata_restored", replace: false }),
        }),
      ),
    );
  });
});
