import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import type { EnginePhase } from "@/lib/ipc/bindings";
import { mockCommands, renderWithApp } from "@/test/harness";

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
    ["broken", "The engine needs a restart", "Restart engine", "engineRestart"],
  ] as const)(
    "offers the next step when the engine is %s",
    async (phase, title, action, command) => {
      const calls = renderPhase(phase);
      expect(await screen.findByRole("heading", { name: title })).toBeDefined();
      await userEvent.click(screen.getByRole("button", { name: action }));
      await waitFor(() => expect(calls.map((call) => call.command)).toContain(command));
    },
  );

  it("shows progress while the engine starts", async () => {
    renderPhase("starting");
    expect(await screen.findByRole("heading", { name: "Starting the engine" })).toBeDefined();
    expect(screen.getByRole("progressbar", { name: "Engine progress" })).toBeDefined();
  });

  it("explains how to get Colima when it's missing", async () => {
    renderPhase("missing");
    expect(await screen.findByText("brew install colima")).toBeDefined();
  });
});
