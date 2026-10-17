import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { infoFixture, namespacesFixture } from "@/test/data-fixtures";
import { mockCommands, renderWithApp } from "@/test/harness";

import { useWorkspace } from "../workspace-store";
import { DiagramView } from "./diagram-view";

describe("DiagramView", () => {
  it("draws each table with its keys and opens one on double-click", async () => {
    mockCommands({});
    renderWithApp(<DiagramView info={infoFixture()} namespaces={namespacesFixture} />);
    const name = await screen.findByText("users", { selector: "b" });
    expect(screen.getAllByLabelText("Primary key").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Foreign key")).toBeDefined();
    fireEvent.doubleClick(name);
    expect(useWorkspace.getState().tabs.pg?.map((tab) => tab.key)).toContain("table:public.users");
  });

  it("says when there is nothing to draw", async () => {
    mockCommands({});
    renderWithApp(<DiagramView info={infoFixture()} namespaces={[]} />);
    expect(await screen.findByText("No tables to draw")).toBeDefined();
  });
});
