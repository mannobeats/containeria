import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { engineFixture, volumeFixture } from "@/test/fixtures";
import { mockCommands, renderWithApp } from "@/test/harness";

import { VolumePage } from "./volume-page";

const route = { path: "volumes/$name", url: "/volumes/shop_pgdata" };

const listing: Record<
  string,
  { name: string; kind: "directory" | "file"; sizeBytes: number; modifiedAt: number }[]
> = {
  "": [
    { name: "base", kind: "directory", sizeBytes: 4096, modifiedAt: 1_760_000_000 },
    { name: "PG_VERSION", kind: "file", sizeBytes: 3, modifiedAt: 1_760_000_000 },
  ],
  base: [],
};

function setup() {
  const calls = mockCommands({
    engineStatus: () => engineFixture(),
    volumesList: () => [
      volumeFixture({
        usedBy: [
          {
            containerId: "db",
            container: "shop-db-1",
            mountedAt: "/var/lib/postgresql/data",
            running: true,
          },
        ],
      }),
    ],
    volumeFiles: (args) => listing[String(args.path)] ?? [],
  });
  renderWithApp(<VolumePage />, { route });
  return calls;
}

describe("VolumePage", () => {
  it("shows which container mounts the volume and where", async () => {
    setup();
    expect(await screen.findByRole("link", { name: "shop-db-1" })).toBeDefined();
    expect(screen.getByText("/var/lib/postgresql/data")).toBeDefined();
  });

  it("browses into a folder and back", async () => {
    const calls = setup();
    expect(await screen.findByText("PG_VERSION")).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: "base" }));
    expect(await screen.findByText("This folder is empty")).toBeDefined();
    expect(calls).toContainEqual({
      command: "volumeFiles",
      args: { name: "shop_pgdata", path: "base" },
    });
    await userEvent.click(screen.getByRole("button", { name: "shop_pgdata" }));
    await waitFor(() => expect(screen.getByText("PG_VERSION")).toBeDefined());
  });

  it("says when the volume was deleted", async () => {
    mockCommands({
      engineStatus: () => engineFixture(),
      volumesList: () => [],
      volumeFiles: () => [],
    });
    renderWithApp(<VolumePage />, { route });
    expect(await screen.findByText("shop_pgdata was deleted")).toBeDefined();
  });
});
