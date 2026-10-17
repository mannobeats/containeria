import { emit } from "@tauri-apps/api/event";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { EnginePhase } from "@/lib/ipc/bindings";

import {
  containerFixture,
  engineFixture,
  metricsFixture,
  preferencesFixture,
} from "@/test/fixtures";
import { mockCommands, renderWithApp } from "@/test/harness";

import { AppShell } from "./app-shell";

function renderShell(phase: EnginePhase, onboarded = true) {
  const calls = mockCommands({
    engineStatus: () => engineFixture({ phase }),
    containersList: () => [containerFixture({ name: "shop-db-1" })],
    metricsLatest: () => metricsFixture(),
    preferencesGet: () => preferencesFixture({ onboarded }),
  });
  const { router } = renderWithApp(<p>Page content</p>, {
    shell: AppShell,
    staticData: { needsEngine: true, title: "Containers" },
  });
  return Object.assign(calls, { router });
}

describe("AppShell", () => {
  it("shows the page while the engine runs", async () => {
    renderShell("running");
    expect(await screen.findByText("Page content")).toBeDefined();
    expect(await screen.findByText("Running")).toBeDefined();
  });

  it("replaces a page that needs the engine while it's stopped", async () => {
    renderShell("stopped");
    expect(await screen.findByRole("heading", { name: "The engine is stopped" })).toBeDefined();
    expect(screen.queryByText("Page content")).toBeNull();
  });

  it("opens the command palette with ⌘K and runs a command", async () => {
    const calls = renderShell("running");
    await screen.findByText("Page content");
    await userEvent.keyboard("{Meta>}k{/Meta}");
    await userEvent.type(
      await screen.findByPlaceholderText("Search or run a command"),
      "stop engine",
    );
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(calls.map((call) => call.command)).toContain("engineStop"));
  });

  it("collapses the sidebar with ⌘\\", async () => {
    renderShell("running");
    await screen.findByText("Page content");
    await userEvent.click(screen.getByRole("button", { name: "Hide sidebar" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Hide sidebar" }).closest("[class*=opacity-0]"),
      ).not.toBeNull(),
    );
  });

  it("opens first launch while the engine was never created", async () => {
    const { router } = renderShell("notCreated", false);
    await waitFor(() => expect(router.state.location.pathname).toBe("/welcome"));
  });

  it("stays put once setup was finished", async () => {
    const { router } = renderShell("notCreated", true);
    await screen.findByRole("heading", { name: "Set up the engine" });
    expect(router.state.location.pathname).toBe("/test");
  });

  it("opens the view the native menu asks for", async () => {
    const { router } = renderShell("running");
    await screen.findByText("Page content");
    await emit("navigate", "/activity");
    await waitFor(() => expect(router.state.location.pathname).toBe("/activity"));
  });
});
