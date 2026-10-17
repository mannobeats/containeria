import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { connectionFixture, detectedFixture } from "@/test/data-fixtures";
import { mockCommands, renderWithApp } from "@/test/harness";

import { useConnectionSheet } from "./connection-sheet-store";
import { DataPage } from "./data-page";
import { useWorkspace } from "./workspace-store";

const history = {
  id: "h1",
  connectionId: "pg",
  connectionName: "billing",
  sql: "select * from invoices",
  atMs: Date.now() - 60_000,
  elapsedMs: 12,
  rows: 3,
  error: null,
};

function setup(empty = false) {
  const calls = mockCommands({
    dataConnections: () =>
      empty
        ? []
        : [
            connectionFixture(),
            connectionFixture({
              id: "lite",
              name: "notes",
              engine: "sqlite",
              file: "~/notes.db",
              environment: "local",
            }),
          ],
    dataDetected: () =>
      empty
        ? []
        : [
            detectedFixture(),
            detectedFixture({
              id: "container:cache",
              containerName: "cache",
              engine: "redis",
              running: false,
              port: null,
              passwordSource: null,
            }),
          ],
    dataHistory: () => (empty ? [] : [history]),
    dataSavedQueries: () =>
      empty ? [] : [{ id: "s1", name: "Late invoices", connectionId: "pg", sql: "select 1" }],
    dataTestConnection: () => "PostgreSQL 18.0",
    dataSaveConnection: () => connectionFixture({ id: "new" }),
  });
  renderWithApp(<DataPage />);
  return calls;
}

beforeEach(() => {
  useWorkspace.setState({ tabs: {}, sql: {} });
  useConnectionSheet.setState({ open: false, connection: undefined });
});

describe("DataPage", () => {
  it("lists databases found in containers beside saved connections", async () => {
    setup();
    expect(await screen.findByText("shop-db-1")).toBeDefined();
    expect(screen.getByText("localhost:5433")).toBeDefined();
    expect(screen.getByText("POSTGRES_PASSWORD")).toBeDefined();
    expect(screen.getByText("Container stopped")).toBeDefined();
    expect(screen.getByText("db.internal:5432")).toBeDefined();
    expect(screen.getByText("~/notes.db")).toBeDefined();
    expect(screen.getByText("Late invoices")).toBeDefined();
  });

  it("filters connections by name or engine", async () => {
    setup();
    await screen.findByText("billing", { selector: "b" });
    await userEvent.type(screen.getByPlaceholderText("Filter connections"), "sqlite");
    expect(screen.queryByText("billing", { selector: "b" })).toBeNull();
    expect(screen.getByText("notes")).toBeDefined();
    expect(screen.getByText("No database containers are running.")).toBeDefined();
  });

  it("invites a first connection when there are none", async () => {
    setup(true);
    expect(await screen.findByText("No databases yet")).toBeDefined();
  });

  it("asks before removing a saved connection", async () => {
    const calls = setup();
    await userEvent.click(await screen.findByRole("button", { name: "More for billing" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Remove Connection…" }));
    await userEvent.click(await screen.findByRole("button", { name: "Remove connection" }));
    await waitFor(() =>
      expect(calls).toContainEqual({ command: "dataRemoveConnection", args: { id: "pg" } }),
    );
  });

  it("removes a saved connection from its right-click menu", async () => {
    const calls = setup();
    fireEvent.contextMenu(await screen.findByRole("row", { name: /billing/ }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Remove Connection…" }));
    await userEvent.click(await screen.findByRole("button", { name: "Remove connection" }));
    await waitFor(() =>
      expect(calls).toContainEqual({ command: "dataRemoveConnection", args: { id: "pg" } }),
    );
  });

  it("copies a detected database's address from its right-click menu", async () => {
    const calls = setup();
    fireEvent.contextMenu(await screen.findByRole("row", { name: /shop-db-1/ }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Copy Address" }));
    await waitFor(() =>
      expect(calls.find((call) => String(call.command).endsWith("writeText"))?.args).toMatchObject({
        text: "localhost:5433",
      }),
    );
  });

  it("deletes a saved query from its right-click menu after asking", async () => {
    const calls = setup();
    fireEvent.contextMenu(await screen.findByRole("button", { name: "Late invoices" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Delete…" }));
    await userEvent.click(await screen.findByRole("button", { name: "Delete query" }));
    await waitFor(() =>
      expect(calls).toContainEqual({ command: "dataDeleteQuery", args: { id: "s1" } }),
    );
  });

  it("reopens a recent query in a new tab of its connection", async () => {
    setup();
    await userEvent.click(await screen.findByRole("button", { name: /select \* from invoices/ }));
    expect(useWorkspace.getState().sql["pg|query:1"]).toBe("select * from invoices");
  });
});

describe("ConnectionSheet", () => {
  it("fills the form from a pasted URL, tests it, and saves", async () => {
    const calls = setup();
    await userEvent.click(await screen.findByRole("button", { name: "New connection" }));
    const sheet = await screen.findByRole("dialog");
    await userEvent.click(within(sheet).getByLabelText("Paste a connection string"));
    await userEvent.paste("postgres://app:secret@db.example.com:6543/shop?sslmode=require");
    expect(within(sheet).getByText("PostgreSQL")).toBeDefined();
    expect((within(sheet).getByLabelText("Host") as HTMLInputElement).value).toBe("db.example.com");
    await userEvent.click(within(sheet).getByRole("button", { name: "Show password" }));
    await userEvent.click(within(sheet).getByRole("button", { name: "Test connection" }));
    expect(await within(sheet).findByText("PostgreSQL 18.0")).toBeDefined();
    await userEvent.clear(within(sheet).getByLabelText("Name"));
    await userEvent.type(within(sheet).getByLabelText("Name"), "shop");
    await userEvent.click(within(sheet).getByRole("button", { name: "Save and connect" }));
    await waitFor(() =>
      expect(calls.find((call) => call.command === "dataSaveConnection")?.args).toMatchObject({
        input: { name: "shop", host: "db.example.com", port: 6543, password: "secret", tls: true },
      }),
    );
  });

  it("names the missing field before anything is sent", async () => {
    const calls = setup();
    await userEvent.click(await screen.findByRole("button", { name: "New connection" }));
    const sheet = await screen.findByRole("dialog");
    await userEvent.click(within(sheet).getByRole("button", { name: /SQLite/ }));
    await userEvent.type(within(sheet).getByLabelText("Name"), "notes");
    await userEvent.click(within(sheet).getByRole("button", { name: "Save and connect" }));
    expect(within(sheet).getByRole("alert").textContent).toBe("Choose the SQLite database file.");
    await userEvent.click(within(sheet).getByRole("radio", { name: "Production" }));
    expect(within(sheet).getByText(/Opens read-only/)).toBeDefined();
    await userEvent.click(within(sheet).getByRole("button", { name: "Change engine" }));
    expect(within(sheet).getByText("Or choose an engine")).toBeDefined();
    expect(calls.map((call) => call.command)).not.toContain("dataSaveConnection");
  });

  it("edits a saved connection without asking for its password again", async () => {
    setup();
    await userEvent.click(await screen.findByRole("button", { name: "More for billing" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Edit Connection…" }));
    const sheet = await screen.findByRole("dialog", { name: "Edit billing" });
    expect(within(sheet).getByText("Saved in your Keychain. Type to replace it.")).toBeDefined();
    expect(within(sheet).queryByRole("button", { name: "Change engine" })).toBeNull();
  });
});
