import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Namespace, QueryResult } from "@/lib/ipc/bindings";
import { infoFixture, namespacesFixture, usersTable } from "@/test/data-fixtures";
import { mockCommands, renderWithApp } from "@/test/harness";

import { useWorkspace } from "../workspace-store";
import { QueryResults } from "./query-results";
import { QueryView } from "./query-view";

const rows: QueryResult = {
  columns: [
    { name: "id", typeName: "int8", kind: "number" },
    { name: "meta", typeName: "jsonb", kind: "json" },
    { name: "active", typeName: "bool", kind: "bool" },
  ],
  rows: [[1, { plan: "pro" }, true]],
  affected: null,
  truncated: true,
  elapsedMs: 3.4,
};

function setup(run: () => QueryResult) {
  useWorkspace.getState().setSql("pg|query:1", "select * from users");
  const saved = { id: "s1", name: "All users", connectionId: "pg", sql: "select * from users" };
  const calls = mockCommands({ dataRun: run, dataSaveQuery: () => saved });
  renderWithApp(
    <QueryView
      info={infoFixture({ readOnly: true })}
      tabKey="query:1"
      namespaces={namespacesFixture}
    />,
  );
  return calls;
}

beforeEach(() => useWorkspace.setState({ tabs: {}, sql: {} }));

describe("QueryView", () => {
  it("runs the tab's SQL and shows the rows it returns", async () => {
    const calls = setup(() => rows);
    expect(await screen.findByLabelText("SQL")).toBeDefined();
    expect(screen.getByText(/Runs read-only/)).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: /Run/ }));
    expect(await screen.findByText(/1 rows, showing the first 5,000/)).toBeDefined();
    expect(screen.getByRole("button", { name: '{"plan":"pro"}' })).toBeDefined();
    expect(screen.getByText("true")).toBeDefined();
    expect(calls.find((call) => call.command === "dataRun")?.args).toMatchObject({
      id: "pg",
      sql: "select * from users",
    });
    await userEvent.click(screen.getByRole("button", { name: "Copy as TSV" }));
  });

  it("shows the database's error", async () => {
    setup(() => {
      throw { kind: "database", message: 'relation "userz" does not exist' };
    });
    await userEvent.click(await screen.findByRole("button", { name: /Run/ }));
    expect(await screen.findByText('relation "userz" does not exist')).toBeDefined();
  });

  it("saves the query under a name", async () => {
    const calls = setup(() => rows);
    await userEvent.click(await screen.findByRole("button", { name: "Save query" }));
    const sheet = await screen.findByRole("dialog");
    await userEvent.type(within(sheet).getByLabelText("Name"), "All users");
    await userEvent.click(within(sheet).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(calls.find((call) => call.command === "dataSaveQuery")?.args).toMatchObject({
        query: { name: "All users", connectionId: "pg", sql: "select * from users" },
      }),
    );
  });

  it("opens the history tab", async () => {
    setup(() => rows);
    await userEvent.click(await screen.findByRole("button", { name: "Query history" }));
    expect(useWorkspace.getState().tabs.pg?.map((tab) => tab.key)).toEqual(["history"]);
  });
});

describe("QueryView for MongoDB", () => {
  const mongo = infoFixture({
    id: "mongo",
    engine: "mongodb",
    version: "MongoDB 8.0.4",
    capabilities: { query: true, sql: false, editRows: true, tables: true, keys: false },
  });
  const collections: Namespace[] = [
    {
      name: "shop",
      tables: [{ ...usersTable, schema: "shop", kind: "collection" }],
      functions: [],
      enums: [],
    },
  ];
  const documents: QueryResult = {
    columns: [
      { name: "_id", typeName: "objectId", kind: "text" },
      { name: "address", typeName: "object", kind: "json" },
    ],
    rows: [["65f1a2b3c4d5e6f708192a3b", { city: "Lisbon" }]],
    affected: null,
    truncated: false,
    elapsedMs: 2,
  };

  it("starts with a find on the first collection and runs it with the results in the grid", async () => {
    const calls = mockCommands({ dataRun: () => documents });
    renderWithApp(<QueryView info={mongo} tabKey="query:1" namespaces={collections} />);
    expect(await screen.findByLabelText("MongoDB query")).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: /Run/ }));
    expect(await screen.findByText("1 rows")).toBeDefined();
    expect(screen.getByText("65f1a2b3c4d5e6f708192a3b")).toBeDefined();
    expect(screen.getByRole("button", { name: '{"city":"Lisbon"}' })).toBeDefined();
    const sent = calls.find((call) => call.command === "dataRun")?.args;
    expect(sent?.id).toBe("mongo");
    expect(JSON.parse(String(sent?.sql))).toEqual({
      database: "shop",
      collection: "users",
      find: {},
      limit: 100,
    });
  });

  it("runs the aggregate typed in the tab and explains safe mode", async () => {
    const pipeline = '{"collection": "users", "aggregate": [{"$count": "n"}]}';
    useWorkspace.getState().setSql("mongo|query:2", pipeline);
    const calls = mockCommands({ dataRun: () => documents });
    renderWithApp(
      <QueryView info={{ ...mongo, readOnly: true }} tabKey="query:2" namespaces={collections} />,
    );
    expect(await screen.findByText(/pipelines with \$out or \$merge wait/)).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: /Run/ }));
    await waitFor(() =>
      expect(calls.find((call) => call.command === "dataRun")?.args.sql).toBe(pipeline),
    );
  });
});

describe("QueryResults", () => {
  it("offers to cancel a running query", async () => {
    const onCancel = vi.fn();
    renderWithApp(<QueryResults result={undefined} error={null} running onCancel={onCancel} />);
    await userEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
  });

  it("counts changed rows for a statement without results", async () => {
    renderWithApp(
      <QueryResults
        result={{ columns: [], rows: [], affected: 3, truncated: false, elapsedMs: 1 }}
        error={null}
        running={false}
        onCancel={() => undefined}
      />,
    );
    expect(await screen.findByText("3 rows affected")).toBeDefined();
  });

  it("says how to run before anything has run", async () => {
    renderWithApp(
      <QueryResults result={undefined} error={null} running={false} onCancel={() => undefined} />,
    );
    expect(await screen.findByText("Run a query to see results here")).toBeDefined();
  });
});
