import { mockIPC } from "@tauri-apps/api/mocks";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { engineFixture } from "@/test/fixtures";
import { mockCommands, renderWithApp } from "@/test/harness";

import { EngineGate } from "./engine-gate";

describe("EngineGate", () => {
  it("keeps the view closed until the engine has answered", async () => {
    mockCommands({});
    mockIPC((command) => (command === "engine_status" ? new Promise(() => undefined) : null));
    renderWithApp(
      <EngineGate title="Containers">
        <p>Page content</p>
      </EngineGate>,
    );
    expect(await screen.findByText("Containers")).toBeDefined();
    expect(screen.queryByText("Page content")).toBeNull();
  });

  it("offers a retry when the engine status can't be read", async () => {
    let attempts = 0;
    const calls = mockCommands({
      engineStatus: () => {
        attempts += 1;
        if (attempts === 1) {
          throw { kind: "engine", message: "`colima list` failed: no output" };
        }
        return engineFixture();
      },
    });
    renderWithApp(
      <EngineGate title="Containers">
        <p>Page content</p>
      </EngineGate>,
    );
    expect(
      await screen.findByRole("heading", { name: "Containeria couldn't check the engine" }),
    ).toBeDefined();
    expect(screen.getByText("`colima list` failed: no output")).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Page content")).toBeDefined();
    await waitFor(() =>
      expect(calls.filter((call) => call.command === "engineStatus").length).toBeGreaterThan(1),
    );
  });
});
