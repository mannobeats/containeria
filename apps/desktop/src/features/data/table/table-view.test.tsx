import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import type { RowPage, ServerInfo } from "@/lib/ipc/bindings";
import { infoFixture, pageFixture, usersTable } from "@/test/data-fixtures";
import { mockCommands, renderWithApp } from "@/test/harness";

import { DEFAULT_VIEW, useWorkspace } from "../workspace-store";
import { TableView } from "./table-view";

function setup({
  page = pageFixture(),
  info = infoFixture(),
}: {
  page?: RowPage;
  info?: ServerInfo;
} = {}) {
  const calls = mockCommands({
    dataRows: () => page,
    dataCommit: () => 1,
    dataPreviewChanges: () => 'UPDATE "public"."users" SET "email" = \'grace@example.com\';',
  });
  renderWithApp(<TableView info={info} table={usersTable} />);
  return calls;
}

/** A full page of 50 rows whose ids start at `first`. */
const fullPage = (first: number) =>
  pageFixture({
    rows: Array.from({ length: 50 }, (_, index) => [
      first + index,
      `user${first + index}@example.com`,
      null,
    ]),
    total: 50,
  });

const lastRequest = (calls: ReturnType<typeof setup>) =>
  calls.filter((call) => call.command === "dataRows").at(-1)?.args.request;

beforeEach(() => useWorkspace.setState({ tabs: {}, views: {}, pending: {} }));

describe("TableView", () => {
  it("reads a page of rows and shows NULL apart from text", async () => {
    setup();
    expect(await screen.findByRole("button", { name: "ada@example.com" })).toBeDefined();
    expect(screen.getAllByText("NULL")).toHaveLength(2);
    expect(screen.getByText(/1–2 of ~2 rows/)).toBeDefined();
  });

  it("stages an edit, then commits it in one go", async () => {
    const calls = setup();
    await userEvent.dblClick(await screen.findByRole("button", { name: "ada@example.com" }));
    const editor = screen.getByLabelText("Edit email");
    await userEvent.clear(editor);
    await userEvent.type(editor, "grace@example.com{Enter}");
    const bar = await screen.findByRole("status");
    expect(bar.textContent).toContain("1 change to users");
    expect(bar.textContent).toContain("1 edited");
    await userEvent.click(within(bar).getByRole("button", { name: /Commit/ }));
    await waitFor(() =>
      expect(calls.find((call) => call.command === "dataCommit")?.args).toEqual({
        id: "pg",
        changes: {
          table: { schema: "public", name: "users" },
          updates: [
            {
              key: [{ column: "id", value: "1" }],
              set: [{ column: "email", value: "grace@example.com" }],
            },
          ],
          inserts: [],
          deletes: [],
        },
      }),
    );
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
  });

  it("shows the SQL a commit runs before running it", async () => {
    const calls = setup();
    await userEvent.dblClick(await screen.findByRole("button", { name: "ada@example.com" }));
    await userEvent.type(screen.getByLabelText("Edit email"), "x{Enter}");
    await userEvent.click(await screen.findByRole("button", { name: /Review SQL/ }));
    const sheet = await screen.findByRole("dialog", { name: "Review SQL" });
    expect(sheet.textContent).toContain("grace@example.com");
    expect(calls.find((call) => call.command === "dataPreviewChanges")?.args).toMatchObject({
      changes: {
        updates: [
          {
            key: [{ column: "id", value: "1" }],
            set: [{ column: "email", value: "ada@example.comx" }],
          },
        ],
      },
    });
    expect(calls.some((call) => call.command === "dataCommit")).toBe(false);
  });

  it("discards staged changes", async () => {
    setup();
    await userEvent.dblClick(await screen.findByRole("button", { name: "ada@example.com" }));
    await userEvent.type(screen.getByLabelText("Edit email"), "x{Enter}");
    expect(await screen.findByRole("status")).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("stages deletes of selected rows and new rows", async () => {
    setup();
    await userEvent.click(await screen.findByRole("button", { name: "Select row 1" }));
    expect(screen.getByText("1 selected")).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await userEvent.click(screen.getByRole("button", { name: "Add row" }));
    const bar = await screen.findByRole("status");
    expect(bar.textContent).toContain("1 added · 1 deleted");
    expect(screen.getByLabelText("New row")).toBeDefined();
  });

  it("cancels an edit with Escape", async () => {
    setup();
    await userEvent.click(await screen.findByRole("button", { name: "ada@example.com" }));
    await userEvent.keyboard("{Enter}");
    expect(screen.getByLabelText("Edit email")).toBeDefined();
    await userEvent.keyboard("changed{Escape}");
    expect(screen.queryByLabelText("Edit email")).toBeNull();
    expect(screen.getByRole("button", { name: "ada@example.com" })).toBeDefined();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("moves between cells with the arrow keys", async () => {
    setup();
    await userEvent.click(await screen.findByRole("button", { name: "ada@example.com" }));
    await userEvent.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(screen.getAllByRole("button", { name: "NULL" })[0]);
    await userEvent.keyboard("{ArrowLeft}");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "2" }));
  });

  it("leaves a NULL cell alone when its editor closes untouched", async () => {
    setup();
    const [email] = await screen.findAllByRole("button", { name: "NULL" });
    if (!email) {
      throw new Error("expected a NULL email");
    }
    await userEvent.dblClick(email);
    await userEvent.keyboard("{Enter}");
    expect(screen.queryByLabelText("Edit email")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("remembers a cell's value from before the edit", async () => {
    const page = pageFixture({ columns: usersTable.columns.map((column) => ({ ...column })) });
    mockCommands({ dataRows: () => page });
    renderWithApp(<TableView info={infoFixture()} table={usersTable} />);
    await userEvent.dblClick(await screen.findByRole("button", { name: "ada@example.com" }));
    await userEvent.type(screen.getByLabelText("Edit email"), "x{Enter}");
    expect(await screen.findByTitle("Was ada@example.com")).toBeDefined();
  });

  it("commits once while ⌘S is held down", async () => {
    const calls = setup();
    await userEvent.dblClick(await screen.findByRole("button", { name: "ada@example.com" }));
    await userEvent.type(screen.getByLabelText("Edit email"), "x{Enter}");
    await screen.findByRole("status");
    fireEvent.keyDown(window, { key: "s", metaKey: true });
    fireEvent.keyDown(window, { key: "s", metaKey: true, repeat: true });
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
    expect(calls.filter((call) => call.command === "dataCommit")).toHaveLength(1);
  });

  it("sizes a column that appears after the grid is drawn", async () => {
    const narrow = pageFixture({
      columns: usersTable.columns.slice(0, 2),
      rows: [[1, "ada@example.com"]],
    });
    const pages = [narrow];
    mockCommands({ dataRows: () => pages.shift() ?? pageFixture() });
    renderWithApp(<TableView info={infoFixture()} table={usersTable} />);
    const grid = await screen.findByRole("table", { name: "users rows" });
    expect(grid.style.width).toBe("392px");
    await userEvent.click(screen.getByRole("button", { name: /^email/ }));
    await waitFor(() =>
      expect(screen.getByRole("table", { name: "users rows" }).style.width).toBe("512px"),
    );
  });

  it("sorts by a column in the database", async () => {
    const calls = setup();
    await userEvent.click(await screen.findByRole("button", { name: /^email/ }));
    await waitFor(() =>
      expect(lastRequest(calls)).toMatchObject({ sort: { column: "email", descending: false } }),
    );
    await userEvent.click(screen.getByRole("button", { name: /^email/ }));
    await waitFor(() => expect(lastRequest(calls)).toMatchObject({ sort: { descending: true } }));
  });
});

describe("TableView right-click menus", () => {
  const menuOn = async (name: string) =>
    fireEvent.contextMenu(await screen.findByRole("button", { name }));

  it("sets a cell to NULL and deletes a row through staged changes", async () => {
    setup();
    await menuOn("ada@example.com");
    await userEvent.click(await screen.findByRole("menuitem", { name: "Set to NULL" }));
    await menuOn("Select row 2");
    await userEvent.click(await screen.findByRole("menuitem", { name: "Delete Row" }));
    const bar = await screen.findByRole("status");
    expect(bar.textContent).toContain("1 edited · 1 deleted");
  });

  it("filters by the right-clicked value", async () => {
    const calls = setup();
    await menuOn("ada@example.com");
    await userEvent.click(await screen.findByRole("menuitem", { name: "Filter by This Value" }));
    await waitFor(() =>
      expect(lastRequest(calls)).toMatchObject({
        filters: [{ column: "email", op: "equals", value: "ada@example.com" }],
      }),
    );
  });

  it("copies the right-clicked value", async () => {
    const calls = setup();
    await menuOn("ada@example.com");
    await userEvent.click(await screen.findByRole("menuitem", { name: "Copy Value" }));
    await waitFor(() =>
      expect(calls.find((call) => String(call.command).endsWith("writeText"))?.args).toMatchObject({
        text: "ada@example.com",
      }),
    );
  });

  it("sorts from a column header's menu", async () => {
    const calls = setup();
    fireEvent.contextMenu(await screen.findByRole("columnheader", { name: /^email/ }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Sort Descending" }));
    await waitFor(() =>
      expect(lastRequest(calls)).toMatchObject({ sort: { column: "email", descending: true } }),
    );
  });

  it("offers no edits on a read-only table", async () => {
    setup({ page: pageFixture({ readOnlyReason: "users has no primary key." }) });
    await menuOn("ada@example.com");
    expect(await screen.findByRole("menuitem", { name: "Copy Row as JSON" })).toBeDefined();
    expect(screen.queryByRole("menuitem", { name: "Set to NULL" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Delete Row" })).toBeNull();
  });
});

describe("TableView filters and panels", () => {
  const addFilter = async () => {
    await userEvent.click(await screen.findByRole("button", { name: "Filter" }));
    await userEvent.selectOptions(screen.getByLabelText("Column"), "email");
    await userEvent.selectOptions(screen.getByLabelText("Condition"), "contains");
    await userEvent.type(screen.getByLabelText("Value"), "ada");
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));
  };

  it("adds a filter as a chip and reads it as SQL", async () => {
    const calls = setup();
    await addFilter();
    await waitFor(() =>
      expect(lastRequest(calls)).toMatchObject({
        filters: [{ column: "email", op: "contains", value: "ada" }],
      }),
    );
    expect(screen.getByText(/where/).textContent).toContain("email");
  });

  it("edits a filter from its chip", async () => {
    const calls = setup();
    await addFilter();
    await userEvent.click(await screen.findByRole("button", { name: /^email.*ada$/ }));
    await userEvent.selectOptions(screen.getByLabelText("Condition"), "startsWith");
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() =>
      expect(lastRequest(calls)).toMatchObject({
        filters: [{ column: "email", op: "startsWith", value: "ada" }],
      }),
    );
  });

  it("removes a filter from its chip", async () => {
    const calls = setup();
    await addFilter();
    await userEvent.click(
      await screen.findByRole("button", { name: "Remove the filter on email" }),
    );
    await waitFor(() => expect(lastRequest(calls)).toMatchObject({ filters: [] }));
  });

  it("offers no next page past the last matching row", async () => {
    useWorkspace.getState().setView("pg|public.users", {
      ...DEFAULT_VIEW,
      size: 50,
      filters: [{ column: "email", op: "isNotNull", value: null }],
    });
    setup({ page: fullPage(1) });
    expect(await screen.findByText(/1–50 of 50 matching rows/)).toBeDefined();
    expect(screen.getByRole("button", { name: "Next page" })).toHaveProperty("disabled", true);
  });

  it("counts only the selected rows on the page shown", async () => {
    const calls = mockCommands({
      dataRows: (args) => fullPage((args.request as { offset: number }).offset + 1),
    });
    useWorkspace.getState().setView("pg|public.users", { ...DEFAULT_VIEW, size: 50 });
    renderWithApp(<TableView info={infoFixture()} table={usersTable} />);
    await userEvent.click(await screen.findByRole("button", { name: "Select row 1" }));
    expect(screen.getByText("1 selected")).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() => expect(lastRequest(calls)).toMatchObject({ offset: 50 }));
    expect(await screen.findByRole("button", { name: "Select row 51" })).toBeDefined();
    expect(screen.queryByText(/selected/)).toBeNull();
  });

  it("says when filters match nothing", async () => {
    useWorkspace.getState().setView("pg|public.users", {
      ...DEFAULT_VIEW,
      filters: [{ column: "email", op: "isNull", value: null }],
    });
    setup({ page: pageFixture({ rows: [], total: 0 }) });
    expect(await screen.findByText("No rows match these filters")).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(useWorkspace.getState().views["pg|public.users"]?.filters).toEqual([]);
  });

  it("explains a read-only table and offers no edits", async () => {
    setup({ page: pageFixture({ readOnlyReason: "users has no primary key." }) });
    expect(await screen.findByText("users has no primary key.")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Add row" })).toBeNull();
  });

  it("shows columns, indexes and foreign keys in Structure", async () => {
    setup();
    await userEvent.click(await screen.findByRole("radio", { name: "Structure" }));
    expect(screen.getByText("users_email_key")).toBeDefined();
    expect(screen.getByText("Foreign keys")).toBeDefined();
    expect(screen.getByText(/1 index/)).toBeDefined();
  });

  it("inspects the active row and steps through rows", async () => {
    setup();
    await userEvent.click(await screen.findByRole("button", { name: "Row inspector" }));
    const inspector = screen.getByRole("complementary", { name: "Row inspector" });
    expect(inspector.textContent).toContain("Select a cell");
    await userEvent.click(screen.getByRole("button", { name: "ada@example.com" }));
    const row = screen.getByRole("complementary", { name: "Row inspector" });
    expect(row.textContent).toContain("ada@example.com");
    await userEvent.click(within(row).getByRole("button", { name: "Next row" }));
    expect(row.textContent).not.toContain("ada@example.com");
    await userEvent.click(within(row).getByRole("button", { name: "Previous row" }));
    expect(row.textContent).toContain("ada@example.com");
    await userEvent.click(within(row).getByRole("button", { name: "Close inspector" }));
    expect(screen.queryByRole("complementary", { name: "Row inspector" })).toBeNull();
  });

  it("copies the inspected row as JSON and as an insert", async () => {
    const calls = setup();
    await userEvent.click(await screen.findByRole("button", { name: "Row inspector" }));
    await userEvent.click(screen.getByRole("button", { name: "ada@example.com" }));
    const row = screen.getByRole("complementary", { name: "Row inspector" });
    await userEvent.click(within(row).getByRole("button", { name: "Copy as JSON" }));
    await userEvent.click(within(row).getByRole("button", { name: "Copy as insert" }));
    const copied = () =>
      calls
        .filter((call) => String(call.command).endsWith("writeText"))
        .map((call) => String(call.args.text));
    await waitFor(() => expect(copied()).toHaveLength(2));
    expect(copied()[0]).toBe('{\n  "id": 1,\n  "email": "ada@example.com",\n  "team_id": 7\n}');
    expect(copied()[1]).toBe(
      'insert into users ("id", "email", "team_id") values (1, \'ada@example.com\', 7);',
    );
  });

  it("follows a foreign key to the row it points at", async () => {
    setup();
    await userEvent.click(await screen.findByRole("button", { name: "Open the teams row" }));
    expect(useWorkspace.getState().views["pg|public.teams"]?.filters).toEqual([
      { column: "id", op: "equals", value: "7" },
    ]);
  });
});
