import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { beforeEach, describe, expect, it } from "vitest";

import type { HistoryEntry } from "@/lib/ipc/bindings";
import { infoFixture } from "@/test/data-fixtures";
import { mockCommands, renderWithApp } from "@/test/harness";
import { Toaster } from "@/ui/toaster";

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
  const { router } = renderWithApp(
    <>
      <HistoryView info={infoFixture()} />
      <Toaster />
    </>,
  );
  return { calls, router };
}

beforeEach(() => {
  useWorkspace.setState({ tabs: {}, sql: {} });
  toast.dismiss();
});

describe("HistoryView", () => {
  it("lists this connection's queries with their outcome", async () => {
    setup();
    expect(await screen.findByText("2 queries on shop-db")).toBeDefined();
    expect(screen.getByText("Failed")).toBeDefined();
    expect(screen.getByText(/12 rows · 8 ms/)).toBeDefined();
    await userEvent.type(screen.getByPlaceholderText("Search history"), "orders");
    expect(screen.getByText("1 query on shop-db")).toBeDefined();
  });

  it("reopens a query in a new editor tab", async () => {
    const { router } = setup();
    const [open] = await screen.findAllByRole("button", { name: "Open in editor" });
    await userEvent.click(open as HTMLElement);
    expect(useWorkspace.getState().sql["pg|query:1"]).toBe("select * from orders");
    await waitFor(() => expect(router.state.location.href).toBe("/data/pg?tab=query%3A1"));
  });

  it("reopens a saved query in a new editor tab", async () => {
    const { router } = setup();
    await userEvent.click(await screen.findByRole("button", { name: "Big orders" }));
    expect(useWorkspace.getState().sql["pg|query:1"]).toBe("select 2");
    await waitFor(() => expect(router.state.location.href).toBe("/data/pg?tab=query%3A1"));
  });

  it("copies a query's SQL", async () => {
    const { calls } = setup();
    const [copy] = await screen.findAllByRole("button", { name: "Copy SQL" });
    await userEvent.click(copy as HTMLElement);
    await waitFor(() =>
      expect(calls.find((call) => String(call.command).endsWith("writeText"))?.args).toMatchObject({
        text: "select * from orders",
      }),
    );
  });

  it("deletes a saved query", async () => {
    const { calls } = setup();
    await userEvent.click(await screen.findByRole("button", { name: "Delete Big orders" }));
    await waitFor(() =>
      expect(calls).toContainEqual({ command: "dataDeleteQuery", args: { id: "s1" } }),
    );
  });

  it("brings a deleted saved query back with Undo", async () => {
    const { calls } = setup();
    await userEvent.click(await screen.findByRole("button", { name: "Delete Big orders" }));
    await userEvent.click(await screen.findByRole("button", { name: "Undo" }));
    await waitFor(() =>
      expect(calls).toContainEqual({
        command: "dataSaveQuery",
        args: { query: { id: "s1", name: "Big orders", connectionId: null, sql: "select 2" } },
      }),
    );
  });
});
