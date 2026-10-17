import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { ContainerDetails, FileEntry } from "@/lib/ipc/bindings";
import { plots, terminals } from "@/test/canvas-mocks";
import {
  containerFixture,
  detailsFixture,
  engineFixture,
  logFixture,
  metricsFixture,
  statsFixture,
} from "@/test/fixtures";
import { mockCommands, renderWithApp, sendToChannel } from "@/test/harness";

import { ContainerPage } from "./container-page";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: vi.fn(() => Promise.resolve("/Users/ada/Downloads/out")),
  open: vi.fn(() => Promise.resolve(["/Users/ada/notes.txt"])),
}));

const files: Record<string, FileEntry[]> = {
  "/": [
    {
      name: "etc",
      kind: "directory",
      size: 4096,
      modified: 1_760_000_000,
      permissions: "drwxr-xr-x",
    },
    {
      name: "hello.txt",
      kind: "file",
      size: 12,
      modified: 1_760_000_000,
      permissions: "-rw-r--r--",
    },
  ],
  "/etc": [{ name: "hosts", kind: "file", size: 200, modified: 0, permissions: "-rw-r--r--" }],
};

function renderPage(tab?: string, overrides: Partial<ContainerDetails> = {}) {
  const details = detailsFixture(overrides);
  const calls = mockCommands({
    engineStatus: () => engineFixture(),
    metricsLatest: () => metricsFixture(),
    containersList: () => [
      containerFixture({ id: "api", name: "shop-api-1", project: "shop", service: "api" }),
      containerFixture({ id: details.id, name: details.name, project: "shop" }),
      containerFixture({ id: "cache", name: "cache" }),
    ],
    containerDetails: () => details,
    containerStats: (args) => {
      queueMicrotask(() => sendToChannel(args.channel, statsFixture()));
      return 1;
    },
    containerLogs: (args) => {
      queueMicrotask(() =>
        sendToChannel(args.channel, [
          logFixture("ready to accept connections"),
          logFixture("FATAL: role missing", "error"),
          logFixture("tick", "debug"),
        ]),
      );
      return 2;
    },
    containerFiles: (args) => files[String(args.path)] ?? [],
    containerShell: (args) => {
      queueMicrotask(() => sendToChannel(args.channel, { kind: "output", text: "root@db:/# " }));
      return 3;
    },
  });
  renderWithApp(<ContainerPage />, {
    route: { path: "containers/$id", url: `/containers/${details.id}${tab ? `?tab=${tab}` : ""}` },
  });
  return calls;
}

const commandsOf = (calls: ReturnType<typeof mockCommands>) => calls.map((call) => call.command);

describe("ContainerPage overview", () => {
  it("shows the container's details, ports, mounts and environment", async () => {
    renderPage();
    expect(await screen.findByRole("heading", { name: "shop-db-1" })).toBeDefined();
    expect(screen.getByText("docker-entrypoint.sh postgres")).toBeDefined();
    expect(screen.getByText("localhost:5433")).toBeDefined();
    expect(screen.getByText("shop_pg")).toBeDefined();
    expect(screen.queryByText("hunter2")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Reveal values" }));
    expect(screen.getByText("hunter2")).toBeDefined();
    expect(screen.getByRole("link", { name: /api/ })).toBeDefined();
  });

  it("draws live CPU and memory while it runs", async () => {
    renderPage();
    await waitFor(() => expect(plots.length).toBeGreaterThanOrEqual(2));
    await waitFor(() => expect(screen.getByText("3.5%")).toBeDefined());
  });

  it("explains a crash", async () => {
    renderPage(undefined, {
      state: "exited",
      exitCode: 1,
      restartCount: 5,
      error: "bind: address already in use",
      startedAt: null,
      finishedAt: "2026-10-17T09:00:00Z",
    });
    expect(await screen.findByText("Exited with code 1")).toBeDefined();
    expect(screen.getByText("bind: address already in use")).toBeDefined();
    expect(screen.getByRole("button", { name: "Start" })).toBeDefined();
  });

  it("says when the container is gone", async () => {
    mockCommands({
      engineStatus: () => engineFixture(),
      containersList: () => [],
      containerDetails: () => {
        throw { kind: "notFound", message: "No such container" };
      },
    });
    renderWithApp(<ContainerPage />, {
      route: { path: "containers/$id", url: "/containers/gone" },
    });
    expect(
      await screen.findByRole("heading", { name: "This container was deleted" }),
    ).toBeDefined();
  });
});

describe("ContainerPage actions", () => {
  it("stops, renames and deletes from the header", async () => {
    const calls = renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Stop" }));
    await userEvent.click(screen.getByRole("button", { name: "More for shop-db-1" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Rename…" }));
    const name = await screen.findByRole("textbox", { name: "Name" });
    await userEvent.clear(name);
    await userEvent.type(name, "orders-db");
    await userEvent.click(screen.getByRole("button", { name: "Rename" }));
    await userEvent.click(screen.getByRole("button", { name: "More for shop-db-1" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Delete…" }));
    await userEvent.click(await screen.findByRole("button", { name: "Delete container" }));
    await waitFor(() => {
      expect(calls).toContainEqual({
        command: "containerAct",
        args: { id: "db0123456789abcdef", action: "stop" },
      });
      expect(calls).toContainEqual({
        command: "containerRename",
        args: { id: "db0123456789abcdef", name: "orders-db" },
      });
      expect(calls).toContainEqual({
        command: "containerAct",
        args: { id: "db0123456789abcdef", action: "remove" },
      });
    });
  });

  it("refuses an invalid image name when committing", async () => {
    const calls = renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "More for shop-db-1" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Commit to image…" }));
    const reference = await screen.findByRole("textbox", { name: "Image name and tag" });
    await userEvent.clear(reference);
    await userEvent.type(reference, "Not Valid");
    await userEvent.click(screen.getByRole("button", { name: "Commit" }));
    expect(await screen.findByText("Use a lowercase name like my-app:snapshot.")).toBeDefined();
    await userEvent.clear(reference);
    await userEvent.type(reference, "shop-db:backup");
    await userEvent.click(screen.getByRole("button", { name: "Commit" }));
    await waitFor(() => expect(commandsOf(calls)).toContain("containerCommit"));
  });

  it("steps to the next container with the header arrows", async () => {
    renderPage();
    await screen.findByRole("heading", { name: "shop-db-1" });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Next container" }).hasAttribute("disabled")).toBe(
        false,
      ),
    );
  });
});

describe("ContainerPage tabs", () => {
  it("streams logs and filters them by level and text", async () => {
    renderPage("logs");
    expect(await screen.findByText("ready to accept connections")).toBeDefined();
    await userEvent.click(screen.getByRole("radio", { name: /Errors/ }));
    expect(screen.queryByText("ready to accept connections")).toBeNull();
    expect(screen.getByText("FATAL: role missing")).toBeDefined();
    await userEvent.click(screen.getByRole("radio", { name: "All" }));
    await userEvent.type(screen.getByPlaceholderText("Search logs"), "tick");
    expect(screen.getByText("tick")).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(await screen.findByText("No output yet")).toBeDefined();
  });

  it("saves the logs to a file", async () => {
    const calls = renderPage("logs");
    await screen.findByText("ready to accept connections");
    await userEvent.click(screen.getByRole("button", { name: "Save logs" }));
    await waitFor(() => expect(commandsOf(calls)).toContain("saveText"));
  });

  it("browses folders and copies files in and out", async () => {
    const calls = renderPage("files");
    await userEvent.click(await screen.findByRole("button", { name: "etc" }));
    expect(await screen.findByText("hosts")).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: "/" }));
    await userEvent.click(await screen.findByRole("button", { name: "hello.txt" }));
    await userEvent.click(screen.getByRole("button", { name: "Upload" }));
    await waitFor(() => {
      expect(calls).toContainEqual({
        command: "containerDownload",
        args: {
          id: "db0123456789abcdef",
          path: "/hello.txt",
          destination: "/Users/ada/Downloads/out",
        },
      });
      expect(calls).toContainEqual({
        command: "containerUpload",
        args: { id: "db0123456789abcdef", directory: "/", sources: ["/Users/ada/notes.txt"] },
      });
    });
  });

  it("opens a shell, types into it and reconnects when it exits", async () => {
    const calls = renderPage("terminal");
    await waitFor(() => expect(terminals.at(-1)?.written).toBe("root@db:/# "));
    const terminal = terminals.at(-1);
    act(() => {
      terminal?.type("ls\r");
      terminal?.resize(100, 30);
    });
    await waitFor(() => {
      expect(calls).toContainEqual({ command: "shellInput", args: { stream: 3, text: "ls\r" } });
      expect(calls).toContainEqual({
        command: "shellResize",
        args: { stream: 3, cols: 100, rows: 30 },
      });
    });
    const shell = calls.find((call) => call.command === "containerShell");
    act(() => sendToChannel(shell?.args.channel, { kind: "closed" }));
    await userEvent.click(await screen.findByRole("button", { name: "Reconnect" }));
    await waitFor(() =>
      expect(commandsOf(calls).filter((command) => command === "containerShell")).toHaveLength(2),
    );
  });

  it("opens a debug shell beside the container", async () => {
    const calls = renderPage("terminal");
    await userEvent.click(await screen.findByRole("switch", { name: "Debug shell" }));
    await waitFor(() =>
      expect(
        calls.some((call) => call.command === "containerShell" && call.args.debug === true),
      ).toBe(true),
    );
  });

  it("asks to start a stopped container before opening a shell", async () => {
    renderPage("terminal", { state: "exited", startedAt: null });
    expect(await screen.findByRole("heading", { name: "shop-db-1 isn't running" })).toBeDefined();
  });

  it("charts CPU, memory, network and disk", async () => {
    renderPage("stats");
    await waitFor(() => expect(plots).toHaveLength(4));
    const plot = plots[0];
    await waitFor(() => expect(plot?.data[0]?.length).toBe(1));
    act(() => plot?.hover(0));
    expect(screen.getAllByRole("img", { name: /CPU/ }).length).toBeGreaterThan(0);
  });

  it("shows inspect JSON with its keys tinted", async () => {
    renderPage("inspect");
    const json = await screen.findByText('"RestartCount"');
    expect(
      within(json.parentElement as HTMLElement).getByText('"db0123456789abcdef"'),
    ).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: "Copy JSON" }));
  });
});
