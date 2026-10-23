import ELK from "elkjs/lib/elk.bundled.js";

import type { Namespace, Table } from "@/lib/ipc/bindings";

import { tableKey } from "../model";

export const NODE_WIDTH = 232;
const HEADER = 34;
const ROW = 22;

export const nodeHeight = (table: Table) => HEADER + table.columns.length * ROW;

export type Link = { id: string; from: string; to: string; column: string };

/**
 * One link per foreign key whose target table is in the diagram. A key without a schema points into
 * its own table's schema, the way SQLite reports them.
 */
export function links(tables: Table[]): Link[] {
  const keys = new Set(tables.map(tableKey));
  return tables.flatMap((table) =>
    table.columns.flatMap((column) => {
      const target = column.references;
      const to = target && tableKey({ schema: target.schema ?? table.schema, name: target.table });
      return to && keys.has(to)
        ? [
            {
              id: `${tableKey(table)}.${column.name}`,
              from: tableKey(table),
              to,
              column: column.name,
            },
          ]
        : [];
    }),
  );
}

export function diagramTables(namespaces: Namespace[]): Table[] {
  return namespaces
    .flatMap((namespace) => namespace.tables)
    .filter((table) => table.kind !== "view");
}

/** Places tables left to right along their foreign keys, the way ELK's layered layout does. */
export async function layout(tables: Table[]): Promise<Record<string, { x: number; y: number }>> {
  const elk = new ELK();
  const graph = await elk.layout({
    id: "schema",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.layered.spacing.nodeNodeBetweenLayers": "110",
      "elk.spacing.nodeNode": "36",
    },
    children: tables.map((table) => ({
      id: tableKey(table),
      width: NODE_WIDTH,
      height: nodeHeight(table),
    })),
    edges: links(tables).map((link) => ({ id: link.id, sources: [link.to], targets: [link.from] })),
  });
  return Object.fromEntries(
    (graph.children ?? []).map((node) => [node.id, { x: node.x ?? 0, y: node.y ?? 0 }]),
  );
}
