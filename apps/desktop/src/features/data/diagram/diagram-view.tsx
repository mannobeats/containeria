import "@xyflow/react/dist/style.css";

import { IconKey, IconLink, IconTable } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import {
  Background,
  BackgroundVariant,
  Controls,
  type Edge,
  Handle,
  type Node,
  type NodeProps,
  Position,
  ReactFlow,
} from "@xyflow/react";

import type { Namespace, ServerInfo, Table } from "@/lib/ipc/bindings";
import { useIsDark } from "@/lib/theme";
import { EmptyState } from "@/ui/empty-state";

import { compactCount, tableKey } from "../model";
import { tableTab, useOpenTab } from "../tabs";
import { diagramTables, layout, links, NODE_WIDTH } from "./layout";

type TableNode = Node<{ table: Table; onOpen: () => void }, "table">;

function TableCard({ data }: NodeProps<TableNode>) {
  const { table, onOpen } = data;
  return (
    <div
      className="overflow-hidden rounded-[10px] bg-surface shadow-2"
      style={{ width: NODE_WIDTH }}
    >
      <Handle type="target" position={Position.Left} className="opacity-0" />
      <button
        type="button"
        onDoubleClick={onOpen}
        // Enter and Space click with no click count; a mouse opens the table on double-click only.
        onClick={(event) => (event.detail === 0 ? onOpen() : undefined)}
        className="flex h-[34px] w-full items-center gap-[7px] border-b-[0.5px] border-line bg-panel-solid px-2.5 text-left text-13 text-ink [&_.tabler-icon]:size-3.5 [&_.tabler-icon]:text-brand"
      >
        <IconTable aria-hidden />
        <b className="truncate">{table.name}</b>
        <span className="ml-auto text-12 font-normal text-ink-3 tabular">
          {compactCount(table.rowEstimate)}
        </span>
      </button>
      {table.columns.map((column) => (
        <div
          key={column.name}
          className="flex h-[22px] items-center gap-1.5 px-2.5 even:bg-[light-dark(oklch(0_0_0/0.015),oklch(1_0_0/0.02))] [&_.tabler-icon]:size-3"
        >
          {column.primaryKey ? <IconKey className="text-warn" aria-label="Primary key" /> : null}
          {column.references ? <IconLink className="text-brand" aria-label="Foreign key" /> : null}
          {column.primaryKey || column.references ? null : <span className="w-3 shrink-0" />}
          <span className="truncate font-mono text-mono-12 text-ink">{column.name}</span>
          <span className="ml-auto truncate font-mono text-mono-12 text-ink-3">
            {column.typeName}
          </span>
        </div>
      ))}
      <Handle type="source" position={Position.Right} className="opacity-0" />
    </div>
  );
}

const NODE_TYPES = { table: TableCard };

/** Every table and its foreign keys, laid out by ELK; double-click a table to open its rows. */
export function DiagramView({ info, namespaces }: { info: ServerInfo; namespaces: Namespace[] }) {
  const dark = useIsDark();
  const open = useOpenTab(info.id);
  const tables = diagramTables(namespaces);
  const positions = useQuery({
    queryKey: ["data", "diagram", info.id, namespaces],
    queryFn: () => layout(tables),
    staleTime: Number.POSITIVE_INFINITY,
  });
  if (tables.length === 0) {
    return (
      <EmptyState title="No tables to draw">Tables and their foreign keys appear here.</EmptyState>
    );
  }
  const nodes: TableNode[] = tables.map((table) => ({
    id: tableKey(table),
    type: "table",
    position: positions.data?.[tableKey(table)] ?? { x: 0, y: 0 },
    data: { table, onOpen: () => open(tableTab(tableKey(table))) },
  }));
  const edges: Edge[] = links(tables).map((link) => ({
    id: link.id,
    source: link.to,
    target: link.from,
    type: "smoothstep",
    style: { stroke: "var(--line-strong)", strokeWidth: 1.5 },
  }));
  return (
    <div className="relative min-h-0 flex-1">
      {positions.data ? (
        <ReactFlow
          key={positions.dataUpdatedAt}
          defaultNodes={nodes}
          defaultEdges={edges}
          nodeTypes={NODE_TYPES}
          colorMode={dark ? "dark" : "light"}
          fitView
          minZoom={0.2}
          proOptions={{ hideAttribution: true }}
          nodesConnectable={false}
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={20}
            size={1.2}
            color="var(--line-strong)"
          />
          <Controls showInteractive={false} position="top-left" />
        </ReactFlow>
      ) : null}
      <p className="absolute bottom-2.5 left-3 m-0 flex items-center gap-1.5 rounded-md bg-[light-dark(oklch(0.995_0_0/0.8),oklch(0.25_0.005_255/0.82))] px-2.5 py-1 text-12 text-ink-3 backdrop-blur-xl [&_.tabler-icon]:size-3">
        <IconKey className="text-warn" aria-hidden /> Primary key{" "}
        <IconLink className="text-brand" aria-hidden /> Foreign key · Drag to arrange, scroll to
        zoom, double-click a table to open it
      </p>
    </div>
  );
}
