import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import type { CliTool, Inventory, SourceStatus } from "@/lib/ipc/bindings";
import { useUi } from "@/shell/ui-store";
import { engineFixture, preferencesFixture } from "@/test/fixtures";
import { mockCommands, renderWithApp } from "@/test/harness";
import { WelcomePage } from "./welcome-page";

const inventory: Inventory = {
  images: ["postgres:18", "redis:8"],
  volumes: ["shop_pgdata"],
  containers: [
    { id: "c1", name: "shop-db-1", image: "postgres:18", project: "shop", running: true },
  ],
};

const docker = (state: CliTool["state"]): CliTool => ({
  name: "docker",
  target: "/usr/local/bin/docker",
  state,
});

function renderWelcome(
  sources: SourceStatus[] | (() => SourceStatus[]),
  tools: CliTool[] | (() => CliTool[]) = [docker("installed")],
) {
  // The tools are there once they were installed, as they are on a real Mac.
  let installed = false;
  const found = () => (typeof tools === "function" ? tools() : tools);
  const calls = mockCommands({
    cliTools: () =>
      installed ? found().map((tool): CliTool => ({ ...tool, state: "installed" })) : found(),
    cliToolsInstall: () => {
      installed = true;
      return null;
    },
    engineStatus: () => engineFixture({ phase: "notCreated" }),
    preferencesGet: () => preferencesFixture({ onboarded: false }),
    hostInfo: () => ({ chip: "Apple M1 Max", cores: 10, memoryBytes: 32 * 1024 ** 3 }),
    migrationSources: typeof sources === "function" ? sources : () => sources,
    migrationInventory: () => inventory,
  });
  const { router } = renderWithApp(<WelcomePage />);
  return { calls, router };
}

const names = (calls: { command: string }[]) => calls.map((call) => call.command);

async function toTheTerminalStep() {
  await userEvent.click(await screen.findByRole("button", { name: "Get started" }));
  await userEvent.click(await screen.findByRole("button", { name: "Continue" }));
  await userEvent.click(await screen.findByRole("button", { name: "Create engine" }));
  await screen.findByRole("heading", { name: "Use docker from the terminal" });
}

async function throughEngine() {
  await toTheTerminalStep();
  // Continue waits for the look at the terminal's tools, and a click before that does nothing.
  const proceed = await screen.findByRole<HTMLButtonElement>("button", { name: "Continue" });
  await waitFor(() => expect(proceed.disabled).toBe(false));
  await userEvent.click(proceed);
}

describe("WelcomePage", () => {
  afterEach(() => useUi.setState({ toolsDeclined: false }));

  it("sizes the engine as picked", async () => {
    const { calls } = renderWelcome([]);
    await userEvent.click(await screen.findByRole("button", { name: "Get started" }));
    const [cpus] = await screen.findAllByRole("slider");
    (cpus as HTMLElement).focus();
    await userEvent.keyboard("{ArrowRight}");
    await userEvent.click(screen.getByRole("switch", { name: "Rosetta" }));
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() =>
      expect(calls).toContainEqual({
        command: "engineSaveConfig",
        args: { config: { ...engineFixture().config, cpus: 5, rosetta: false } },
      }),
    );
  });

  it("creates the engine, copies what's picked and finishes", async () => {
    const { calls, router } = renderWelcome([
      { source: "dockerDesktop", installed: false, running: false },
      { source: "orbStack", installed: true, running: true },
    ]);
    await throughEngine();
    await waitFor(() =>
      expect(names(calls)).toEqual(expect.arrayContaining(["engineSaveConfig", "engineStart"])),
    );
    await userEvent.click(await screen.findByRole("checkbox", { name: "Copy redis:8" }));
    await userEvent.click(
      screen.getByRole("switch", { name: "Start containers that were running" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Copy 3 items" }));
    await waitFor(() =>
      expect(calls.find((call) => call.command === "migrationImport")?.args).toMatchObject({
        source: "orbStack",
        plan: {
          images: ["postgres:18"],
          volumes: ["shop_pgdata"],
          containers: ["c1"],
          start: true,
        },
      }),
    );
    await userEvent.click(await screen.findByRole("button", { name: "Continue" }));
    await userEvent.click(await screen.findByRole("button", { name: "Open Contena" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/containers"));
    expect(calls).toContainEqual({
      command: "preferencesSet",
      args: { preferences: preferencesFixture({ onboarded: true }) },
    });
    expect(calls.map((call) => call.command)).toContain("plugin:autostart|enable");
  });

  it("installs docker for the terminal on a Mac that has none", async () => {
    const { calls } = renderWelcome([], [docker("missing")]);
    await toTheTerminalStep();
    expect(await screen.findByText("Not in your terminal yet: docker.")).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: "Install…" }));
    expect(await screen.findByText(/Your terminal has docker/)).toBeDefined();
    expect(names(calls)).toContain("cliToolsInstall");
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("heading", { name: /Bring|Copy|Import/ })).toBeDefined();
  });

  it("moves on without the tools when they are turned down", async () => {
    const { calls } = renderWelcome([], [docker("missing")]);
    await toTheTerminalStep();
    await userEvent.click(await screen.findByRole("button", { name: "Not now" }));
    await waitFor(() => expect(names(calls)).toContain("migrationSources"));
    expect(names(calls)).not.toContain("cliToolsInstall");
    // The Containers page doesn't ask again.
    expect(useUi.getState().toolsDeclined).toBe(true);
  });

  it("lets setup go on when the terminal's tools can't be checked", async () => {
    const { calls } = renderWelcome([], () => {
      throw { kind: "io", message: "The app's tools are missing." };
    });
    await toTheTerminalStep();
    expect(await screen.findByText(/couldn't check your terminal's tools/)).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(names(calls)).toContain("migrationSources"));
  });

  it("explains when the app to copy from has to be opened first", async () => {
    const { calls } = renderWelcome([
      { source: "dockerDesktop", installed: true, running: false },
      { source: "orbStack", installed: false, running: false },
    ]);
    await throughEngine();
    expect(await screen.findByText(/Open Docker Desktop to copy/)).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: "Check again" }));
    await waitFor(() =>
      expect(names(calls).filter((name) => name === "migrationSources")).toHaveLength(2),
    );
  });

  it("says when it couldn't look for apps to copy from", async () => {
    renderWelcome(() => {
      throw { kind: "io", message: "Spotlight is off" };
    });
    await throughEngine();
    expect(await screen.findByText(/couldn't look for Docker Desktop and OrbStack/)).toBeDefined();
    expect(screen.getByText(/Spotlight is off/)).toBeDefined();
    expect(screen.queryByText(/Neither Docker Desktop nor OrbStack/)).toBeNull();
  });

  it("says why Check again failed instead of keeping the old answer", async () => {
    let looked = false;
    renderWelcome(() => {
      if (looked) {
        throw { kind: "io", message: "Spotlight is off" };
      }
      looked = true;
      return [{ source: "dockerDesktop", installed: true, running: false }];
    });
    await throughEngine();
    expect(await screen.findByText(/Open Docker Desktop to copy/)).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: "Check again" }));
    expect(await screen.findByText(/Spotlight is off/)).toBeDefined();
    expect(screen.queryByText(/Open Docker Desktop to copy/)).toBeNull();
  });

  it("can be skipped, and doesn't open again", async () => {
    const { calls, router } = renderWelcome([]);
    await userEvent.click(await screen.findByRole("button", { name: "Skip setup" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/containers"));
    expect(calls).toContainEqual({
      command: "preferencesSet",
      args: { preferences: preferencesFixture({ onboarded: true }) },
    });
  });
});
