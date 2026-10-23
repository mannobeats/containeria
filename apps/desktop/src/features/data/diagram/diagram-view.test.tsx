import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { infoFixture, namespacesFixture } from "@/test/data-fixtures";
import { mockCommands, renderWithApp } from "@/test/harness";

import { useWorkspace } from "../workspace-store";
import { DiagramView } from "./diagram-view";

beforeEach(() => useWorkspace.setState({ tabs: {} }));

describe("DiagramView", () => {
  it("draws each table with its keys, and no views", async () => {
    mockCommands({});
    renderWithApp(<DiagramView info={infoFixture()} namespaces={namespacesFixture} />);
    expect(await screen.findByText("users", { selector: "b" })).toBeDefined();
    expect(screen.getByText("teams", { selector: "b" })).toBeDefined();
    expect(screen.queryByText("active_teams", { selector: "b" })).toBeNull();
    expect(screen.getAllByLabelText("Primary key")).toHaveLength(2);
    expect(screen.getAllByLabelText("Foreign key")).toHaveLength(1);
  });

  it("opens a table on double-click, not on a single click", async () => {
    mockCommands({});
    renderWithApp(<DiagramView info={infoFixture()} namespaces={namespacesFixture} />);
    const users = await screen.findByText("users", { selector: "b" });
    fireEvent.click(users, { detail: 1 });
    expect(useWorkspace.getState().tabs.pg).toBeUndefined();
    fireEvent.doubleClick(users);
    expect(useWorkspace.getState().tabs.pg?.map((tab) => tab.key)).toEqual(["table:public.users"]);
  });

  it("opens a table from the keyboard", async () => {
    mockCommands({});
    renderWithApp(<DiagramView info={infoFixture()} namespaces={namespacesFixture} />);
    (await screen.findByText("teams", { selector: "b" })).closest("button")?.focus();
    await userEvent.keyboard("{Enter}");
    expect(useWorkspace.getState().tabs.pg?.map((tab) => tab.key)).toEqual(["table:public.teams"]);
  });

  it("says when there is nothing to draw", async () => {
    mockCommands({});
    renderWithApp(<DiagramView info={infoFixture()} namespaces={[]} />);
    expect(await screen.findByText("No tables to draw")).toBeDefined();
  });
});
