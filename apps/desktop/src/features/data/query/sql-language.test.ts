import { CompletionContext, type CompletionSource } from "@codemirror/autocomplete";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import type { Namespace, Table } from "@/lib/ipc/bindings";

import { completionSchema, sqlLanguage } from "./sql-language";

function table(name: string, columns: string[]): Table {
  return {
    schema: null,
    name,
    kind: "table",
    rowEstimate: null,
    sizeBytes: null,
    indexes: [],
    columns: columns.map((column) => ({
      name: column,
      typeName: "text",
      kind: "text",
      nullable: true,
      primaryKey: false,
      references: null,
      default: null,
    })),
  };
}

const namespaces: Namespace[] = [
  { name: "public", tables: [table("orders", ["id", "total"])], functions: [], enums: [] },
  { name: "auth", tables: [table("users", ["email"])], functions: [], enums: [] },
];

/** What the editor offers at the end of `doc`, as a user pressing Ctrl-Space would see it. */
async function completions(doc: string) {
  const state = EditorState.create({ doc, extensions: sqlLanguage("postgres", namespaces) });
  // The parser stops after a time budget; on a busy machine `orders.` may not be parsed yet.
  ensureSyntaxTree(state, doc.length, 5000);
  const sources = state.languageDataAt<CompletionSource>("autocomplete", doc.length);
  const context = new CompletionContext(state, doc.length, true);
  const results = await Promise.all(sources.map((source) => source(context)));
  return results.flatMap((result) => result?.options.map((option) => option.label) ?? []);
}

describe("SQL completion", () => {
  it("offers a first-schema table's columns without its schema", async () => {
    expect(await completions("select orders.")).toEqual(expect.arrayContaining(["id", "total"]));
  });

  it("offers a table's columns under its schema", async () => {
    expect(await completions("select auth.users.")).toEqual(["email"]);
  });

  it("completes without a schema on engines it has no dialect for", () => {
    expect(completionSchema([])).toEqual({ schema: {} });
    expect(sqlLanguage("clickhouse", [])).toHaveLength(2);
  });
});
