import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import type { AppUpdate } from "@/lib/ipc/bindings";
import { mockCommands, renderWithApp } from "@/test/harness";

import { UpdateNotice } from "./update-notice";
import { UpdateSection } from "./update-section";

const newer: AppUpdate = { version: "0.2.0", notes: "Faster starts." };

describe("UpdateSection", () => {
  it("says so when this is the newest version", async () => {
    mockCommands({ updateCheck: () => null });
    renderWithApp(<UpdateSection version="0.1.2" />);
    expect(await screen.findByText("Contena 0.1.2 is the newest version.")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Update and Restart" })).toBeNull();
  });

  it("offers a newer version with what it brings, and installs it when asked", async () => {
    const calls = mockCommands({ updateCheck: () => newer });
    renderWithApp(<UpdateSection version="0.1.2" />);
    expect(await screen.findByText("Contena 0.2.0 is available.")).toBeDefined();
    expect(screen.getByText("Faster starts.")).toBeDefined();
    expect(screen.getByText(/Running containers stop/)).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: "Update and Restart" }));
    await waitFor(() => expect(calls.map((call) => call.command)).toContain("updateInstall"));
  });

  it("says why when it couldn't look, and looks again when asked", async () => {
    let online = false;
    const calls = mockCommands({
      updateCheck: () => {
        if (!online) {
          throw { kind: "internal", message: "The Mac is offline." };
        }
        return newer;
      },
    });
    renderWithApp(<UpdateSection version="0.1.2" />);
    expect(await screen.findByText("Contena couldn't look for a newer version.")).toBeDefined();
    expect(screen.getByText("The Mac is offline.")).toBeDefined();
    online = true;
    await userEvent.click(screen.getByRole("button", { name: "Check Again" }));
    expect(await screen.findByText("Contena 0.2.0 is available.")).toBeDefined();
    expect(calls.filter((call) => call.command === "updateCheck")).toHaveLength(2);
  });
});

describe("UpdateNotice", () => {
  it("stays away while there is nothing newer", async () => {
    const calls = mockCommands({ updateFound: () => null });
    renderWithApp(<UpdateNotice />);
    await waitFor(() => expect(calls.map((call) => call.command)).toContain("updateFound"));
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("names the version found and opens Settings where it is installed", async () => {
    const calls = mockCommands({ updateFound: () => newer });
    renderWithApp(<UpdateNotice />);
    await userEvent.click(await screen.findByRole("button", { name: "Update to 0.2.0" }));
    await waitFor(() =>
      expect(calls).toContainEqual({ command: "settingsOpen", args: { pane: "about" } }),
    );
  });
});
