import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { connectionFixture } from "@/test/data-fixtures";
import { mockCommands, renderWithApp } from "@/test/harness";

import { SidebarConnections } from "./sidebar-connections";

describe("SidebarConnections", () => {
  it("links saved connections and marks production ones", async () => {
    mockCommands({
      dataConnections: () => [
        connectionFixture(),
        connectionFixture({ id: "dev", name: "dev", environment: "local" }),
      ],
    });
    renderWithApp(<SidebarConnections />);
    const billing = await screen.findByRole("link", { name: /billing/ });
    expect(billing.getAttribute("href")).toBe("/data/pg");
    expect(screen.getAllByLabelText("Production")).toHaveLength(1);
  });

  it("removes a connection from its right-click menu after asking", async () => {
    const calls = mockCommands({ dataConnections: () => [connectionFixture()] });
    renderWithApp(<SidebarConnections />);
    fireEvent.contextMenu(await screen.findByRole("link", { name: /billing/ }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Remove Connection…" }));
    await userEvent.click(await screen.findByRole("button", { name: "Remove connection" }));
    await waitFor(() =>
      expect(calls).toContainEqual({ command: "dataRemoveConnection", args: { id: "pg" } }),
    );
  });
});
