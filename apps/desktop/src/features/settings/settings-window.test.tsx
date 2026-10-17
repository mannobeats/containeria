import { emit } from "@tauri-apps/api/event";
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import type { EnginePhase, SettingsPane } from "@/lib/ipc/bindings";
import { engineFixture, preferencesFixture } from "@/test/fixtures";
import { mockCommands, renderWithApp } from "@/test/harness";

import { SettingsWindow } from "./settings-window";

function renderSection(section: SettingsPane, phase: EnginePhase = "running") {
  const calls = mockCommands({
    settingsPane: () => section,
    engineStatus: () =>
      engineFixture({
        phase,
        instance: {
          status: "running",
          arch: "aarch64",
          cpus: 4,
          memoryBytes: 8 * 1024 ** 3,
          diskBytes: 0,
          address: null,
        },
      }),
    preferencesGet: () => preferencesFixture(),
    hostInfo: () => ({ chip: "Apple M1 Max", cores: 10, memoryBytes: 32 * 1024 ** 3 }),
    about: () => ({
      appVersion: "0.1.0",
      colimaVersion: "0.10.3",
      engine: {
        serverVersion: "29.1.0",
        kernelVersion: "6.8.0",
        operatingSystem: "Ubuntu 24.04",
        cpus: 4,
        memoryBytes: 0,
      },
    }),
  });
  renderWithApp(<SettingsWindow />);
  return calls;
}

const commandsOf = (calls: { command: string }[]) => calls.map((call) => call.command);

describe("SettingsWindow", () => {
  it("asks for a pane from its toolbar and shows the one Rust names", async () => {
    const calls = renderSection("general");
    await userEvent.click(await screen.findByRole("button", { name: "About" }));
    await waitFor(() =>
      expect(calls).toContainEqual({ command: "settingsOpen", args: { pane: "about" } }),
    );
    await act(() => emit("settings-pane-shown", "about"));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "About" }).getAttribute("aria-current")).toBe(
        "page",
      ),
    );
  });

  it("switches appearance and menu bar settings", async () => {
    const calls = renderSection("general");
    await userEvent.click(await screen.findByRole("radio", { name: "Dark" }));
    expect(document.documentElement.dataset.theme).toBe("dark");
    await userEvent.click(screen.getByRole("radio", { name: "Automatic" }));
    await userEvent.click(await screen.findByRole("switch", { name: "Memory in the menu bar" }));
    await waitFor(() =>
      expect(calls).toContainEqual({
        command: "preferencesSet",
        args: { preferences: preferencesFixture({ memoryInMenuBar: false }) },
      }),
    );
  });

  it("saves engine changes and offers a restart", async () => {
    const calls = renderSection("engine");
    expect(await screen.findByText("Apple M1 Max")).toBeDefined();
    expect(screen.getByRole("combobox", { name: "Virtualization" })).toHaveProperty(
      "disabled",
      true,
    );
    await userEvent.click(screen.getByRole("switch", { name: "UDP ports" }));
    expect(screen.getByText("Not saved: UDP ports on")).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(commandsOf(calls)).toContain("engineSaveConfig"));
    await userEvent.click(await screen.findByRole("button", { name: "Restart engine" }));
    await waitFor(() => expect(commandsOf(calls)).toContain("engineRestart"));
  });

  it("says a saved change applies at the next start while the engine is stopped", async () => {
    renderSection("kubernetes", "stopped");
    await userEvent.click(await screen.findByRole("switch", { name: "Kubernetes" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText(/next time it starts/)).toBeDefined();
  });

  it("discards unsaved changes", async () => {
    renderSection("kubernetes");
    await userEvent.clear(await screen.findByRole("textbox", { name: "Kubernetes version" }));
    await userEvent.type(
      screen.getByRole("textbox", { name: "Kubernetes version" }),
      "v1.34.1+k3s1",
    );
    expect(screen.getByText("Not saved: Kubernetes v1.34.1+k3s1")).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(screen.queryByText(/Not saved/)).toBeNull();
  });

  it("edits registries one per line", async () => {
    renderSection("docker");
    await userEvent.type(
      await screen.findByRole("textbox", { name: "Registry mirrors" }),
      " https://mirror.gcr.io \n",
    );
    await userEvent.tab();
    expect(await screen.findByText("Not saved: registries")).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(screen.getByText(/docker\.sock/)).toBeDefined();
  });

  it("shows the versions it runs", async () => {
    renderSection("about");
    expect(await screen.findByText("0.10.3")).toBeDefined();
    expect(screen.getByText("29.1.0")).toBeDefined();
    expect(screen.getByText(/Version 0\.1\.0/)).toBeDefined();
  });
});
