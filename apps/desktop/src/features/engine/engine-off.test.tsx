import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import type { EnginePhase } from "@/lib/ipc/bindings";
import { engineFixture } from "@/test/fixtures";
import { mockCommands, renderWithApp } from "@/test/harness";
import { Toaster } from "@/ui/toaster";

import { EngineOff } from "./engine-off";

function renderPhase(phase: EnginePhase) {
  const calls = mockCommands({});
  renderWithApp(<EngineOff phase={phase} />);
  return calls;
}

describe("EngineOff", () => {
  it.each([
    ["stopped", "The engine is stopped", "Start engine", "engineStart"],
    ["notCreated", "Set up the engine", "Create engine", "engineStart"],
    ["broken", "The engine stopped unexpectedly", "Start engine", "engineStart"],
  ] as const)(
    "offers the next step when the engine is %s",
    async (phase, title, action, command) => {
      const calls = renderPhase(phase);
      expect(await screen.findByRole("heading", { name: title })).toBeDefined();
      await userEvent.click(screen.getByRole("button", { name: action }));
      await waitFor(() => expect(calls.map((call) => call.command)).toContain(command));
    },
  );

  it("says when Engine settings didn't open", async () => {
    mockCommands({
      settingsOpen: () => {
        throw { kind: "io", message: "The Settings window is gone" };
      },
    });
    renderWithApp(
      <>
        <EngineOff phase="stopped" />
        <Toaster />
      </>,
    );
    await userEvent.click(await screen.findByRole("button", { name: "Engine settings" }));
    expect(await screen.findByText("Settings didn't open")).toBeDefined();
    expect(screen.getByText("The Settings window is gone")).toBeDefined();
  });

  it("says why the engine stopped, in its own words", async () => {
    mockCommands({
      engineStatus: () =>
        engineFixture({ phase: "broken", problem: "The VM helper wasn't found." }),
    });
    renderWithApp(<EngineOff phase="broken" />);
    expect(await screen.findByText("The VM helper wasn't found.")).toBeDefined();
  });

  it("shows a sleeping engine as starting, since showing it wakes it", async () => {
    renderPhase("asleep");
    expect(await screen.findByRole("heading", { name: "Starting the engine" })).toBeDefined();
  });

  it("shows progress while the engine starts", async () => {
    renderPhase("starting");
    expect(await screen.findByRole("heading", { name: "Starting the engine" })).toBeDefined();
    expect(screen.getByRole("progressbar", { name: "Engine progress" })).toBeDefined();
  });

  it("says how to build the engine when a development build lacks it", async () => {
    renderPhase("missing");
    expect(await screen.findByText("scripts/build-engine.sh")).toBeDefined();
  });
});
