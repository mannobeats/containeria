import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ImportPreview, ServerInfo } from "@/lib/ipc/bindings";
import { infoFixture, namespacesFixture, usersTable } from "@/test/data-fixtures";
import { mockCommands, renderWithApp } from "@/test/harness";

import { SchemaTree } from "../schema-tree";
import { useTableAction } from "../table-action-store";
import { TableActionSheets } from "./table-action-sheets";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: () => Promise.resolve("/Users/ada/users.csv"),
  save: () => Promise.resolve(null),
}));

const preview: ImportPreview = {
  columns: ["ID", "E-mail", "Team", "notes"],
  rows: [["1", "ada@example.com", "3", null]],
  delimiter: "semicolon",
};

function setup({ info = infoFixture(), fail = false }: { info?: ServerInfo; fail?: boolean } = {}) {
  const calls = mockCommands({
    dataImportPreview: () => preview,
    dataImport: () => {
      if (fail) {
        throw { kind: "database", message: "value too long (row 7 of the file)" };
      }
      return 2;
    },
    dataSchema: () => namespacesFixture,
  });
  renderWithApp(
    <>
      <SchemaTree info={info} namespaces={namespacesFixture} active={undefined} />
      <TableActionSheets info={info} />
    </>,
  );
  return calls;
}

const openImport = async () => {
  fireEvent.contextMenu(await screen.findByRole("button", { name: /^users/ }));
  await userEvent.click(await screen.findByRole("menuitem", { name: "Import Data…" }));
  return screen.findByRole("dialog", { name: "Import into users" });
};

beforeEach(() => useTableAction.setState({ action: null }));

describe("ImportSheet", () => {
  it("matches file columns by name and imports with the options picked", async () => {
    const calls = setup();
    const sheet = await openImport();
    expect(sheet.textContent).toContain("users.csv");
    expect(await screen.findByRole("option", { name: "Detect (Semicolon)" })).toBeDefined();
    expect((screen.getByLabelText("Column for ID") as HTMLSelectElement).value).toBe("id");
    expect((screen.getByLabelText("Column for E-mail") as HTMLSelectElement).value).toBe("email");
    expect((screen.getByLabelText("Column for Team") as HTMLSelectElement).value).toBe("");
    await userEvent.selectOptions(screen.getByLabelText("Column for Team"), "team_id");
    await userEvent.click(screen.getByRole("checkbox", { name: "Empty the table first" }));
    await userEvent.click(screen.getByRole("button", { name: "Import" }));
    await waitFor(() =>
      expect(calls.find((call) => call.command === "dataImport")?.args).toMatchObject({
        id: "pg",
        request: {
          table: { schema: "public", name: "users" },
          path: "/Users/ada/users.csv",
          options: { format: "csv", header: true, delimiter: "auto" },
          mapping: [
            { source: "ID", column: "id" },
            { source: "E-mail", column: "email" },
            { source: "Team", column: "team_id" },
          ],
          emptyFirst: true,
        },
      }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() =>
      expect(calls).toContainEqual({ command: "dataSchema", args: { id: "pg", refresh: true } }),
    );
  });

  it("reads the file again when the header option changes", async () => {
    const calls = setup();
    await openImport();
    await userEvent.click(await screen.findByRole("checkbox", { name: "First row is the header" }));
    await waitFor(() =>
      expect(calls.filter((call) => call.command === "dataImportPreview").at(-1)?.args).toEqual({
        path: "/Users/ada/users.csv",
        options: { format: "csv", header: false, delimiter: "auto" },
      }),
    );
  });

  it("keeps the sheet open and names the row the database refused", async () => {
    setup({ fail: true });
    await openImport();
    await userEvent.click(await screen.findByRole("button", { name: "Import" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Nothing was imported.");
    expect(alert.textContent).toContain("row 7 of the file");
    expect(screen.getByRole("dialog", { name: "Import into users" })).toBeDefined();
  });

  it("waits for writes to be allowed on a production database", async () => {
    setup({ info: infoFixture({ environment: "production", readOnly: true }) });
    act(() =>
      useTableAction.getState().show({ kind: "import", table: usersTable, path: "/tmp/u.json" }),
    );
    await screen.findByLabelText("Column for ID");
    expect(screen.getByText(/Safe mode is on/)).toBeDefined();
    expect(screen.getByRole("button", { name: "Import" }).hasAttribute("disabled")).toBe(true);
    expect(screen.queryByRole("checkbox", { name: "First row is the header" })).toBeNull();
  });
});
