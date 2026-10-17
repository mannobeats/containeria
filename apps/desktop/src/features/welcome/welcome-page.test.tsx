import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import type { DockerDesktop } from "@/lib/ipc/bindings";
import { engineFixture, preferencesFixture } from "@/test/fixtures";
import { mockCommands, renderWithApp } from "@/test/harness";

import { WelcomePage } from "./welcome-page";

function renderWelcome(desktop: DockerDesktop) {
  const calls = mockCommands({
    engineStatus: () => engineFixture({ phase: "notCreated" }),
    preferencesGet: () => preferencesFixture({ onboarded: false }),
    hostInfo: () => ({ chip: "Apple M1 Max", cores: 10, memoryBytes: 32 * 1024 ** 3 }),
    dockerDesktopDetect: () => desktop,
  });
  const { router } = renderWithApp(<WelcomePage />);
  return { calls, router };
}

const names = (calls: { command: string }[]) => calls.map((call) => call.command);

async function throughEngine() {
  await userEvent.click(await screen.findByRole("button", { name: "Get started" }));
  await userEvent.click(await screen.findByRole("button", { name: "Continue" }));
  await userEvent.click(await screen.findByRole("button", { name: "Create engine" }));
}

describe("WelcomePage", () => {
  it("sizes and creates the engine, copies images and finishes", async () => {
    const { calls, router } = renderWelcome({
      installed: true,
      running: true,
      images: ["postgres:18", "redis:8"],
    });
    await throughEngine();
    await waitFor(() =>
      expect(names(calls)).toEqual(expect.arrayContaining(["engineSaveConfig", "engineStart"])),
    );
    await userEvent.click(await screen.findByRole("checkbox", { name: "Copy redis:8" }));
    await userEvent.click(screen.getByRole("button", { name: "Copy 1 image" }));
    await waitFor(() =>
      expect(
        calls.find((call) => call.command === "dockerDesktopImportImages")?.args["references"],
      ).toEqual(["postgres:18"]),
    );
    await userEvent.click(await screen.findByRole("button", { name: "Continue" }));
    await userEvent.click(await screen.findByRole("button", { name: "Open Containeria" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/containers"));
    expect(calls).toContainEqual({
      command: "preferencesSet",
      args: { preferences: preferencesFixture({ onboarded: true }) },
    });
  });

  it("explains when Docker Desktop has to be opened first", async () => {
    const { calls } = renderWelcome({ installed: true, running: false, images: [] });
    await throughEngine();
    expect(await screen.findByText(/Open Docker Desktop/)).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: "Check again" }));
    await waitFor(() =>
      expect(names(calls).filter((name) => name === "dockerDesktopDetect")).toHaveLength(2),
    );
  });

  it("can be skipped", async () => {
    const { router } = renderWelcome({ installed: false, running: false, images: [] });
    await userEvent.click(await screen.findByRole("button", { name: "Skip setup" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/containers"));
  });
});
