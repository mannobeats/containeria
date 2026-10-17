import { screen } from "@testing-library/react";
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
});
