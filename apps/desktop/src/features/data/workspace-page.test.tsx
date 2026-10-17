import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import type { Namespace, ServerInfo } from "@/lib/ipc/bindings";
import { infoFixture, namespacesFixture, pageFixture } from "@/test/data-fixtures";
import { mockCommands, renderWithApp } from "@/test/harness";

import { WorkspacePage } from "./workspace-page";
import { useWorkspace } from "./workspace-store";

type Setup = { info?: ServerInfo; namespaces?: Namespace[]; tab?: string; fail?: boolean };

function setup({ info = infoFixture(), namespaces = namespacesFixture, tab, fail }: Setup = {}) {
  const calls = mockCommands({
    dataConnect: () => {
      if (fail) {
        throw { kind: "database", message: "password authentication failed for user app" };
      }
      return info;
    },
    dataSchema: () => namespaces,
    dataRows: () => pageFixture(),
    dataHistory: () => [],
    dataSavedQueries: () => [],
    dataAllowWrites: () => ({ ...info, readOnly: false, writableUntilMs: Date.now() + 900_000 }),
    dataSafeMode: () => ({ ...info, readOnly: true }),
  });
  const url = tab ? `/data/pg?tab=${encodeURIComponent(tab)}` : "/data/pg";
  renderWithApp(<WorkspacePage />, { path: "data/$connection", url });
  return calls;
}

beforeEach(() => useWorkspace.setState({ tabs: {}, sql: {}, views: {}, pending: {} }));

describe("WorkspacePage", () => {
  it("connects, lists the schema, and opens the first table", async () => {
    setup();
    const tree = await screen.findByRole("navigation", { name: "Tables" });
    expect(await within(tree).findByText("teams")).toBeDefined();
    expect(within(tree).getByText("now_utc")).toBeDefined();
    expect(within(tree).getByText("role")).toBeDefined();
    expect(await screen.findByRole("button", { name: "ada@example.com" })).toBeDefined();
    expect(screen.getByRole("tab", { name: "users" }).getAttribute("aria-selected")).toBe("true");
  });

  it("says why it couldn't connect and tries again", async () => {
    const calls = setup({ fail: true });
    expect(await screen.findByText(/password authentication failed/)).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() =>
      expect(calls.filter((call) => call.command === "dataConnect")).toHaveLength(2),
    );
  });

  it("finds tables by a column name and opens them as tabs", async () => {
    setup();
    await screen.findByRole("navigation", { name: "Tables" });
    await userEvent.type(screen.getByPlaceholderText("Find a table or column"), "name");
    const tree = screen.getByRole("navigation", { name: "Tables" });
    expect(within(tree).queryByText("users")).toBeNull();
    await userEvent.click(within(tree).getByRole("button", { name: /^teams/ }));
    expect(await screen.findByRole("tab", { name: "teams" })).toBeDefined();
  });

  it("asks before closing a tab with staged changes", async () => {
    useWorkspace.getState().setPending("pg|public.users", (pending) => ({
      ...pending,
      added: [{ email: "new@example.com" }],
    }));
    setup();
    await userEvent.click(await screen.findByRole("button", { name: "Close users" }));
    await userEvent.click(await screen.findByRole("button", { name: "Discard and close" }));
    expect(useWorkspace.getState().pending["pg|public.users"]?.added).toEqual([]);
  });

  it("opens query, diagram and history tabs from the tree", async () => {
    setup();
    await screen.findByRole("navigation", { name: "Tables" });
    const [newQuery] = screen.getAllByRole("button", { name: "New query" });
    await userEvent.click(newQuery as HTMLElement);
    expect(await screen.findByRole("tab", { name: "Query 1" })).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: "History" }));
    expect(await screen.findByText("No queries on shop-db yet")).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: "Schema diagram" }));
    expect(await screen.findByRole("tab", { name: "Schema diagram" })).toBeDefined();
  });

  it("names a table tab whose table is gone", async () => {
    setup({ tab: "table:public.ghost" });
    expect(await screen.findByText("There's no table named ghost")).toBeDefined();
  });

  it("has nothing open when the database has no tables", async () => {
    setup({ namespaces: [] });
    expect(await screen.findByText("Nothing open")).toBeDefined();
  });
});

describe("Safe mode", () => {
  it("opens production read-only and allows writes for 15 minutes on request", async () => {
    const calls = setup({ info: infoFixture({ environment: "production", readOnly: true }) });
    expect(await screen.findByText("Production, read-only.")).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: "Allow writes for 15 min" }));
    await userEvent.click(await screen.findByRole("button", { name: "Allow writes" }));
    expect(await screen.findByText("Writes allowed")).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: "Turn safe mode back on" }));
    await waitFor(() => expect(calls.map((call) => call.command)).toContain("dataSafeMode"));
    expect(calls).toContainEqual({ command: "dataAllowWrites", args: { id: "pg", minutes: 15 } });
  });
});
