import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { DataLocation, DiskUsage } from "@/lib/ipc/bindings";
import { mockCommands, renderWithApp, sendToChannel } from "@/test/harness";

import { StoragePane } from "./storage-pane";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: () => Promise.resolve("/Volumes/Fast SSD") }));

const GB = 1_000_000_000;

const atHome: DataLocation = {
  path: "/Users/ada/.containeria/colima/_lima",
  isDefault: true,
  available: true,
  sizeBytes: 8.4 * GB,
};

const usage: DiskUsage = {
  images: { count: 14, active: 3, sizeBytes: 1.9 * GB, reclaimableBytes: 1.6 * GB },
  containers: { count: 4, active: 2, sizeBytes: 2048, reclaimableBytes: 1024 },
  volumes: { count: 0, active: 0, sizeBytes: 0, reclaimableBytes: 0 },
  buildCache: { count: 9, active: 0, sizeBytes: 3 * GB, reclaimableBytes: 3 * GB },
};

let channel: unknown;
let location: DataLocation;

function setup(at: DataLocation = atHome) {
  channel = undefined;
  location = at;
  return mockCommands({
    storageLocation: () => location,
    storageUsage: () => usage,
    storageCheck: (args) =>
      args.folder ? `${String(args.folder)}/Containeria` : "/Users/ada/.containeria/colima/_lima",
    storageMove: (args) => {
      channel = args.channel;
      return 3;
    },
    buildCachePrune: () => ({ removed: 9, reclaimedBytes: 3 * GB }),
  });
}

describe("StoragePane", () => {
  it("shows where the data is and what takes space in the engine", async () => {
    setup();
    renderWithApp(<StoragePane />);
    expect(await screen.findByText(atHome.path)).toBeDefined();
    expect(screen.getByText(/8.4 GB of disk images/)).toBeDefined();
    expect(await screen.findByText(/14 images/)).toBeDefined();
    expect(screen.queryByRole("button", { name: "Move Back" })).toBeNull();
  });

  it("moves the data to a picked folder, showing each step", async () => {
    const calls = setup();
    renderWithApp(<StoragePane />);
    await userEvent.click(await screen.findByRole("button", { name: "Change…" }));
    expect(await screen.findByText("/Volumes/Fast SSD/Containeria")).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: "Move Data" }));
    await waitFor(() =>
      expect(calls).toContainEqual(
        expect.objectContaining({
          command: "storageMove",
          args: expect.objectContaining({ folder: "/Volumes/Fast SSD" }),
        }),
      ),
    );
    expect(await screen.findByText("Stopping the engine and Linux machines…")).toBeDefined();
    sendToChannel(channel, {
      kind: "copying",
      progress: { copiedBytes: 2 * GB, totalBytes: 8 * GB },
    });
    expect(await screen.findByText("Moving 2.0 GB of 8.0 GB")).toBeDefined();
    sendToChannel(channel, { kind: "starting" });
    expect(await screen.findByText("Starting them again…")).toBeDefined();
    sendToChannel(channel, { kind: "done", location: atHome, restartError: null });
    expect(await screen.findByText(atHome.path)).toBeDefined();
  });

  it("offers to move data on another drive back, and warns when that drive is missing", async () => {
    const calls = setup({
      path: "/Volumes/Fast SSD/Containeria",
      isDefault: false,
      available: false,
      sizeBytes: 0,
    });
    renderWithApp(<StoragePane />);
    expect(await screen.findByText(/isn't connected/)).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: "Move Back" }));
    expect(await screen.findByText("/Users/ada/.containeria/colima/_lima")).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: "Move Data" }));
    await waitFor(() =>
      expect(calls).toContainEqual(
        expect.objectContaining({
          command: "storageMove",
          args: expect.objectContaining({ folder: null }),
        }),
      ),
    );
    location = atHome;
    sendToChannel(channel, { kind: "done", location: atHome, restartError: null });
    expect(await screen.findByText(atHome.path)).toBeDefined();
    expect(screen.queryByRole("button", { name: "Move Back" })).toBeNull();
    expect(screen.queryByText(/isn't connected/)).toBeNull();
  });

  it("still shows a move after switching to another pane and back", async () => {
    const calls = setup();
    const { unmount } = renderWithApp(<StoragePane />);
    await userEvent.click(await screen.findByRole("button", { name: "Change…" }));
    await userEvent.click(await screen.findByRole("button", { name: "Move Data" }));
    expect(await screen.findByText("Stopping the engine and Linux machines…")).toBeDefined();
    await waitFor(() => expect(calls.map((call) => call.command)).toContain("storageMove"));
    unmount();
    renderWithApp(<StoragePane />);
    expect(await screen.findByText("Stopping the engine and Linux machines…")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Change…" })).toBeNull();
    sendToChannel(channel, { kind: "done", location: atHome, restartError: null });
    expect(await screen.findByRole("button", { name: "Change…" })).toBeDefined();
  });

  it("asks before clearing the build cache", async () => {
    const calls = setup();
    renderWithApp(<StoragePane />);
    await screen.findByText(/9 entries/);
    const buttons = screen.getAllByRole("button", { name: "Clean Up…" });
    await userEvent.click(buttons.at(-1) as HTMLElement);
    expect(await screen.findByText("Clear the build cache?")).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(calls.map((call) => call.command)).toContain("buildCachePrune"));
  });
});
