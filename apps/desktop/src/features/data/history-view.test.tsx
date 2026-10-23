import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import type { HistoryEntry } from "@/lib/ipc/bindings";
import { infoFixture } from "@/test/data-fixtures";
import { mockCommands, renderWithApp } from "@/test/harness";

import { HistoryView } from "./history-view";
import { useWorkspace } from "./workspace-store";

const entry = (id: string, sql: string, overrides: Partial<HistoryEntry> = {}): HistoryEntry => ({
  id,
  connectionId: "pg",
  connectionName: "shop-db",
  sql,
  atMs: Date.now() - 5_000,
  elapsedMs: 8,
  rows: 12,
  error: null,
  ...overrides,
});

function setup() {
  const calls = mockCommands({
    dataHistory: () => [
      entry("1", "select * from orders"),
      entry("2", "delete from carts", { rows: null, error: "permission denied" }),
      entry("3", "select 1", { connectionId: "other" }),
    ],
    dataSavedQueries: () => [{ id: "s1", name: "Big orders", connectionId: null, sql: "select 2" }],
  });
  renderWithApp(<HistoryView info={infoFixture()} />);
  return calls;
}

beforeEach(() => useWorkspace.setState({ tabs: {}, sql: {} }));

describe("HistoryView", () => {
  it("lists this connection's queries with their outcome", async () => {
    setup();
    expect(await screen.findByText("2 queries on shop-db")).toBeDefined();
    expect(screen.getByText("Failed")).toBeDefined();
    expect(screen.getByText(/12 rows · 8 ms/)).toBeDefined();
    await userEvent.type(screen.getByPlaceholderText("Search history"), "orders");
    expect(screen.getByText("1 query on shop-db")).toBeDefined();
  });

  it("reopens a query or a saved one in the editor", async () => {
    setup();
    const [open] = await screen.findAllByRole("button", { name: "Open in editor" });
    await userEvent.click(open as HTMLElement);
    expect(useWorkspace.getState().sql["pg|query:1"]).toBe("select * from orders");
    await userEvent.click(screen.getByRole("button", { name: "Big orders" }));
    expect(useWorkspace.getState().sql["pg|query:2"]).toBe("select 2");
    const [copy] = screen.getAllByRole("button", { name: "Copy SQL" });
    await userEvent.click(copy as HTMLElement);
  });

  it("deletes a saved query", async () => {
    const calls = setup();
    await userEvent.click(await screen.findByRole("button", { name: "Delete Big orders" }));
    await waitFor(() =>
      expect(calls).toContainEqual({ command: "dataDeleteQuery", args: { id: "s1" } }),
    );
  });
});
