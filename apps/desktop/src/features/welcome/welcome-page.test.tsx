import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import type { Inventory, SourceStatus } from "@/lib/ipc/bindings";
import { engineFixture, preferencesFixture } from "@/test/fixtures";
import { mockCommands, renderWithApp } from "@/test/harness";

import { WelcomePage } from "./welcome-page";

const inventory: Inventory = {
  images: ["postgres:18", "redis:8"],
  volumes: [
    { name: "shop_pgdata", inUseBy: ["shop-db-1"] },
    { name: "shop_media", inUseBy: [] },
  ],
  containers: [
    { id: "c1", name: "shop-db-1", image: "postgres:18", project: "shop", running: true },
  ],
};

function renderWelcome(sources: SourceStatus[] | (() => SourceStatus[])) {
  const calls = mockCommands({
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

function desktop(status: Partial<SourceStatus> = {}): SourceStatus {
  const source = { kind: "dockerDesktop", instance: null } as const;
  return { source, label: "Docker Desktop", installed: true, running: false, ...status };
}

function orbStack(status: Partial<SourceStatus> = {}): SourceStatus {
  const source = { kind: "orbStack", instance: null } as const;
  return { source, label: "OrbStack", installed: true, running: false, ...status };
}

function colima(instance: string): SourceStatus {
  const source = { kind: "colima", instance } as const;
  return { source, label: `Colima (${instance})`, installed: true, running: true };
}

async function throughEngine() {
  await userEvent.click(await screen.findByRole("button", { name: "Get started" }));
  await userEvent.click(await screen.findByRole("button", { name: "Continue" }));
  await userEvent.click(await screen.findByRole("button", { name: "Create engine" }));
}

describe("WelcomePage", () => {
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
      desktop({ installed: false }),
      orbStack({ running: true }),
    ]);
    await throughEngine();
    await waitFor(() =>
      expect(names(calls)).toEqual(expect.arrayContaining(["engineSaveConfig", "engineStart"])),
    );
    await userEvent.click(await screen.findByRole("checkbox", { name: "Copy redis:8" }));
    await userEvent.click(
      screen.getByRole("switch", { name: "Start containers that were running" }),
    );
    await userEvent.click(screen.getByRole("checkbox", { name: "Copy shop_media" }));
    expect(screen.getByText(/OrbStack is running next to Containeria/)).toBeDefined();
    expect(screen.getByText(/shop_pgdata is in use by shop-db-1/)).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: "Copy 3 items" }));
    expect(names(calls)).not.toContain("migrationImport");
    await userEvent.click(await screen.findByRole("button", { name: "Copy anyway" }));
    await waitFor(() =>
      expect(calls.find((call) => call.command === "migrationImport")?.args).toMatchObject({
        source: { kind: "orbStack", instance: null },
        plan: {
          images: ["postgres:18"],
          volumes: ["shop_pgdata"],
          containers: ["c1"],
          start: true,
        },
      }),
    );
    await userEvent.click(await screen.findByRole("button", { name: "Continue" }));
    await userEvent.click(await screen.findByRole("button", { name: "Open Containeria" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/containers"));
    expect(calls).toContainEqual({
      command: "preferencesSet",
      args: { preferences: preferencesFixture({ onboarded: true }) },
    });
    expect(calls.map((call) => call.command)).toContain("plugin:autostart|enable");
  });

  it("explains when the app to copy from has to be opened first", async () => {
    const { calls } = renderWelcome([desktop(), orbStack({ installed: false })]);
    await throughEngine();
    expect(await screen.findByText(/Start Docker Desktop to copy/)).toBeDefined();
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
    expect(await screen.findByText(/couldn't look for other container engines/)).toBeDefined();
    expect(screen.getByText(/Spotlight is off/)).toBeDefined();
    expect(screen.queryByText(/No other container engine/)).toBeNull();
  });

  it("says why Check again failed instead of keeping the old answer", async () => {
    let looked = false;
    renderWelcome(() => {
      if (looked) {
        throw { kind: "io", message: "Spotlight is off" };
      }
      looked = true;
      return [desktop()];
    });
    await throughEngine();
    expect(await screen.findByText(/Start Docker Desktop to copy/)).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: "Check again" }));
    expect(await screen.findByText(/Spotlight is off/)).toBeDefined();
    expect(screen.queryByText(/Start Docker Desktop to copy/)).toBeNull();
  });

  it("names each Colima profile and copies from the one picked", async () => {
    const { calls } = renderWelcome([desktop(), colima("default"), colima("work")]);
    await throughEngine();
    expect(
      await screen.findByText(/Colima \(default\) and Colima \(work\) are running next to/),
    ).toBeDefined();
    await userEvent.click(screen.getByRole("radio", { name: "Colima (work)" }));
    await userEvent.click(await screen.findByRole("checkbox", { name: "Copy shop_pgdata" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Copy shop-db-1" }));
    await userEvent.click(screen.getByRole("button", { name: "Copy 3 items" }));
    await waitFor(() =>
      expect(calls.find((call) => call.command === "migrationImport")?.args).toMatchObject({
        source: { kind: "colima", instance: "work" },
      }),
    );
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
