import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { Machine } from "@/lib/ipc/bindings";
import { mockCommands, renderWithApp } from "@/test/harness";

import { machineFixture, machinesStatusFixture } from "./fixtures";
import { MachineView } from "./machine-page";

const terminal = vi.hoisted(() => ({ input: (_: string): unknown => undefined }));

vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    loadAddon = vi.fn();
    open = vi.fn();
    focus = vi.fn();
    dispose = vi.fn();
    write = vi.fn();
    onData(handler: (data: string) => void) {
      terminal.input = handler;
      return { dispose: vi.fn() };
    }
    onResize() {
      return { dispose: vi.fn() };
    }
  },
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit = vi.fn();
  },
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: () => Promise.resolve("/Users/ada/notes.txt"),
  save: () => Promise.resolve("/Users/ada/Downloads/os-release"),
}));

type Tab = "overview" | "terminal" | "files";

function setup(tab: Tab, machine: Machine = machineFixture()) {
  const onTab = vi.fn();
  const onLeave = vi.fn();
  const calls = mockCommands({
    machinesStatus: () => machinesStatusFixture(),
    machinesList: () => [machine],
    machineShell: () => 7,
    machineFiles: ({ path }) =>
      path === "/root"
        ? [
            { name: "projects", path: "/root/projects", kind: "directory", sizeBytes: 0 },
            { name: "notes.txt", path: "/root/notes.txt", kind: "file", sizeBytes: 2048 },
          ]
        : [{ name: "app.py", path: "/root/projects/app.py", kind: "file", sizeBytes: 120 }],
  });
  renderWithApp(<MachineView name={machine.name} tab={tab} onTab={onTab} onLeave={onLeave} />);
  return { calls, onTab, onLeave };
}

describe("MachineView", () => {
  it("shows what the machine is and what it uses", async () => {
    const { onTab } = setup("overview");
    expect(await screen.findByRole("heading", { name: "ubuntu-dev" })).toBeDefined();
    expect(screen.getByText("2 CPUs · 4 GB")).toBeDefined();
    expect(screen.getByText("/Users/ada")).toBeDefined();
    await userEvent.click(screen.getByRole("tab", { name: "Files" }));
    expect(onTab).toHaveBeenCalledWith("files");
  });

  it("opens a shell and sends keystrokes to it", async () => {
    const { calls } = setup("terminal");
    await waitFor(() =>
      expect(calls.find((call) => call.command === "machineShell")?.args).toMatchObject({
        name: "ubuntu-dev",
        cols: 80,
        rows: 24,
      }),
    );
    terminal.input("ls\r");
    await waitFor(() =>
      expect(calls).toContainEqual({ command: "machineShellInput", args: { id: 7, data: "ls\r" } }),
    );
  });

  it("browses folders and downloads a file", async () => {
    const { calls } = setup("files");
    await userEvent.click(await screen.findByRole("button", { name: "projects" }));
    expect(await screen.findByText("app.py")).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: "root" }));
    await userEvent.click(await screen.findByRole("button", { name: "Download notes.txt" }));
    await waitFor(() =>
      expect(calls).toContainEqual({
        command: "machineFileDownload",
        args: {
          name: "ubuntu-dev",
          path: "/root/notes.txt",
          destination: "/Users/ada/Downloads/os-release",
        },
      }),
    );
  });

  it("uploads a Mac file into the open folder", async () => {
    const { calls } = setup("files");
    await screen.findByText("notes.txt");
    await userEvent.click(screen.getByRole("button", { name: "Upload" }));
    await waitFor(() =>
      expect(calls).toContainEqual({
        command: "machineFileUpload",
        args: { name: "ubuntu-dev", source: "/Users/ada/notes.txt", directory: "/root" },
      }),
    );
  });

  it("offers to start a stopped machine instead of a terminal", async () => {
    const { calls } = setup("terminal", machineFixture({ state: "stopped" }));
    await userEvent.click(await screen.findByRole("button", { name: "Start ubuntu-dev" }));
    await waitFor(() =>
      expect(calls).toContainEqual({
        command: "machineAct",
        args: { name: "ubuntu-dev", action: "start" },
      }),
    );
  });

  it("stops the machine from the header", async () => {
    const { calls } = setup("overview");
    await userEvent.click(await screen.findByRole("button", { name: "Stop" }));
    await waitFor(() =>
      expect(calls).toContainEqual({
        command: "machineAct",
        args: { name: "ubuntu-dev", action: "stop" },
      }),
    );
  });

  it("leaves after deleting the machine", async () => {
    const { calls, onLeave } = setup("overview");
    await userEvent.click(await screen.findByRole("button", { name: "More for ubuntu-dev" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Delete machine…" }));
    const sheet = await screen.findByRole("dialog", { name: "Delete ubuntu-dev?" });
    await userEvent.click(within(sheet).getByRole("button", { name: "Delete machine" }));
    await waitFor(() => expect(calls.map((call) => call.command)).toContain("machineDelete"));
    await waitFor(() => expect(onLeave).toHaveBeenCalled());
  });

  it("says when the machine doesn't exist", async () => {
    mockCommands({ machinesStatus: () => machinesStatusFixture(), machinesList: () => [] });
    renderWithApp(<MachineView name="gone" tab="overview" onTab={vi.fn()} onLeave={vi.fn()} />);
    expect(await screen.findByRole("heading", { name: "gone doesn't exist" })).toBeDefined();
  });
});
