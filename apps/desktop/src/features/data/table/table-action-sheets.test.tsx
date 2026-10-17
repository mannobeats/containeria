import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { infoFixture, namespacesFixture } from "@/test/data-fixtures";
import { mockCommands, renderWithApp } from "@/test/harness";

import { SchemaTree } from "../schema-tree";
import { useTableAction } from "../table-action-store";
import { TableActionSheets } from "./table-action-sheets";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: () => Promise.resolve(null),
  save: () => Promise.resolve("/Users/ada/users.json"),
}));

function setup(info = infoFixture()) {
  const calls = mockCommands({
    dataTruncate: () => namespacesFixture,
    dataDropTable: () => namespacesFixture,
    dataExport: () => 2,
  });
  renderWithApp(
    <>
      <SchemaTree info={info} namespaces={namespacesFixture} active={undefined} />
      <TableActionSheets info={info} />
    </>,
  );
  return calls;
}

const menuOn = async (name: RegExp) => {
  fireEvent.contextMenu(await screen.findByRole("button", { name }));
  return screen.findByRole("menu");
};

beforeEach(() => useTableAction.setState({ action: null }));

describe("Table actions", () => {
  it("drops a table only once its name is typed", async () => {
    const calls = setup();
    await userEvent.click(
      within(await menuOn(/^users/)).getByRole("menuitem", { name: "Drop Table…" }),
    );
    const sheet = await screen.findByRole("dialog", { name: "Drop users?" });
    const drop = within(sheet).getByRole("button", { name: "Drop Table" });
    expect(drop.hasAttribute("disabled")).toBe(true);
    const name = within(sheet).getByLabelText("Type users to confirm");
    await userEvent.type(name, "user");
    expect(drop.hasAttribute("disabled")).toBe(true);
    await userEvent.type(name, "s");
    expect(drop.hasAttribute("disabled")).toBe(false);
    await userEvent.click(drop);
    await waitFor(() =>
      expect(calls).toContainEqual({
        command: "dataDropTable",
        args: { id: "pg", table: { schema: "public", name: "users" } },
      }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("truncates after asking", async () => {
    const calls = setup();
    await userEvent.click(
      within(await menuOn(/^users/)).getByRole("menuitem", { name: "Truncate Table…" }),
    );
    const sheet = await screen.findByRole("dialog", { name: "Empty users?" });
    expect(sheet.textContent).toContain("public.users");
    await userEvent.click(within(sheet).getByRole("button", { name: "Truncate Table" }));
    await waitFor(() =>
      expect(calls).toContainEqual({
        command: "dataTruncate",
        args: { id: "pg", table: { schema: "public", name: "users" } },
      }),
    );
  });

  it("refuses to drop in safe mode", async () => {
    setup(infoFixture({ environment: "production", readOnly: true }));
    await userEvent.click(
      within(await menuOn(/^users/)).getByRole("menuitem", { name: "Drop Table…" }),
    );
    const sheet = await screen.findByRole("dialog", { name: "Drop users?" });
    await userEvent.type(within(sheet).getByLabelText("Type users to confirm"), "users");
    expect(within(sheet).getByRole("button", { name: "Drop Table" }).hasAttribute("disabled")).toBe(
      true,
    );
    expect(sheet.textContent).toContain("Safe mode is on");
  });

  it("exports a whole table in the format its file name picks", async () => {
    const calls = setup();
    await userEvent.click(
      within(await menuOn(/^users/)).getByRole("menuitem", { name: "Export…" }),
    );
    await waitFor(() =>
      expect(calls.find((call) => call.command === "dataExport")?.args).toMatchObject({
        format: "json",
        path: "/Users/ada/users.json",
        request: { table: { schema: "public", name: "users" }, filters: [] },
      }),
    );
  });

  it("offers only export on a view", async () => {
    setup();
    const menu = await menuOn(/^active_teams/);
    expect(within(menu).getByRole("menuitem", { name: "Export…" })).toBeDefined();
    expect(within(menu).queryByRole("menuitem", { name: "Import Data…" })).toBeNull();
    expect(within(menu).queryByRole("menuitem", { name: "Drop Table…" })).toBeNull();
  });
});
