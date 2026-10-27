import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { mockCommands, renderWithApp } from "@/test/harness";

import { AdvancedPane } from "./advanced-pane";

describe("AdvancedPane", () => {
  it("installs only the tools that are missing", async () => {
    const calls = mockCommands({
      cliTools: () => [
        { name: "cx", target: "/usr/local/bin/cx", state: "missing" },
        { name: "docker", target: "/usr/local/bin/docker", state: "other" },
      ],
    });
    renderWithApp(<AdvancedPane />);
    expect(await screen.findByText("Your own copy")).toBeDefined();
    expect(screen.getByText("1 not installed")).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: "Install…" }));
    await waitFor(() => expect(calls.map((call) => call.command)).toContain("cliToolsInstall"));
  });

  it("resets the engine only after the word is typed", async () => {
    const calls = mockCommands({ cliTools: () => [] });
    renderWithApp(<AdvancedPane />);
    await userEvent.click(await screen.findByRole("button", { name: "Reset Engine…" }));
    const confirm = await screen.findByRole("button", { name: "Reset Engine" });
    expect(confirm.hasAttribute("disabled")).toBe(true);
    await userEvent.click(
      screen.getByRole("checkbox", { name: "Also delete every Linux machine" }),
    );
    await userEvent.type(screen.getByLabelText('Type "reset" to confirm'), "reset");
    await userEvent.click(confirm);
    await waitFor(() =>
      expect(calls).toContainEqual({ command: "engineReset", args: { machines: true } }),
    );
  });

  it("has nothing to install once every tool is there", async () => {
    mockCommands({
      cliTools: () => [{ name: "cx", target: "/usr/local/bin/cx", state: "installed" }],
    });
    renderWithApp(<AdvancedPane />);
    expect(await screen.findByText("Everything is installed")).toBeDefined();
    expect(screen.getByRole("button", { name: "Install…" }).hasAttribute("disabled")).toBe(true);
  });
});
