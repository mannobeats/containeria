import type { Table } from "@/lib/ipc/bindings";

/**
 * A MongoDB query tab's starting text: a `find` on a collection that the user edits. The same
 * object takes `projection`, `sort`, `skip`, or `aggregate` with a pipeline instead of `find`.
 */
export function mongoQuery(table: Table | undefined): string {
  return JSON.stringify(
    {
      database: table?.schema ?? "test",
      collection: table?.name ?? "collection",
      find: {},
      limit: 100,
    },
    null,
    2,
  );
}
