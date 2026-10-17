import {
  IconChevronRight,
  IconEye,
  IconFolder,
  IconHistory,
  IconListDetails,
  IconMathFunction,
  IconSchema,
  IconSql,
  IconTable,
} from "@tabler/icons-react";
import clsx from "clsx";
import { useState } from "react";

import type { Namespace, ServerInfo, Table } from "@/lib/ipc/bindings";
import { SearchField } from "@/ui/search-field";
import { Tile } from "@/ui/tile";
import { Tip } from "@/ui/tooltip";

import { engineLogo } from "./engines";
import { compactCount, tableKey } from "./model";
import { tableTab, useOpenTab } from "./tabs";
import { nextQueryTab, useWorkspace } from "./workspace-store";

const rowClass =
  "flex h-[26px] w-full items-center gap-[7px] rounded-sm px-2 text-left text-13 text-ink-2 transition-colors duration-140 hover:bg-hover hover:text-ink [&_.tabler-icon]:size-3.5 [&_.tabler-icon]:text-ink-3";

function matches(table: Table, needle: string): boolean {
  return (
    needle === "" ||
    table.name.toLowerCase().includes(needle) ||
    table.columns.some((column) => column.name.toLowerCase().includes(needle))
  );
}

type GroupProps = {
  namespace: Namespace;
  first: boolean;
  active: string | undefined;
  needle: string;
  onOpen: (table: Table) => void;
};

function Group({ namespace, first, active, needle, onOpen }: GroupProps) {
  const tables = namespace.tables.filter(
    (table) => table.kind !== "view" && matches(table, needle),
  );
  const views = namespace.tables.filter((table) => table.kind === "view" && matches(table, needle));
  return (
    <details
      open={
        first ||
        needle !== "" ||
        namespace.tables.some((table) => `table:${tableKey(table)}` === active)
      }
      className="group/ns"
    >
      <summary
        className={clsx(
          rowClass,
          "list-none font-medium text-ink [&::-webkit-details-marker]:hidden",
        )}
      >
        <IconChevronRight
          className="transition-transform duration-140 group-open/ns:rotate-90"
          aria-hidden
        />
        <IconFolder aria-hidden />
        <span className="truncate">{namespace.name}</span>
        <span className="ml-auto text-12 font-[450] text-ink-3 tabular">
          {namespace.tables.length}
        </span>
      </summary>
      {[...tables, ...views].map((table) => (
        <button
          key={tableKey(table)}
          type="button"
          onClick={() => onOpen(table)}
          className={clsx(
            rowClass,
            "pl-7",
            `table:${tableKey(table)}` === active &&
              "bg-select font-medium text-ink [&_.tabler-icon]:text-brand",
          )}
        >
          {table.kind === "view" ? <IconEye aria-hidden /> : <IconTable aria-hidden />}
          <span className="truncate">{table.name}</span>
          <span className="ml-auto text-12 font-[450] text-ink-3 tabular">
            {compactCount(table.rowEstimate)}
          </span>
        </button>
      ))}
      {namespace.functions.slice(0, 50).map((name) => (
        <Tip key={name} label={name} side="right">
          <span className={clsx(rowClass, "pl-7")}>
            <IconMathFunction aria-hidden />
            <span className="truncate font-mono text-mono-12">{name}</span>
          </span>
        </Tip>
      ))}
      {namespace.enums.map((item) => (
        <Tip key={item.name} label={item.values.join(", ")} side="right">
          <span className={clsx(rowClass, "pl-7")}>
            <IconListDetails aria-hidden />
            <span className="truncate">{item.name}</span>
            <span className="ml-auto text-12 text-ink-3 tabular">{item.values.length}</span>
          </span>
        </Tip>
      ))}
    </details>
  );
}

type SchemaTreeProps = { info: ServerInfo; namespaces: Namespace[]; active: string | undefined };

/** The connection, its schemas and tables, and the ways into queries and the diagram. */
export function SchemaTree({ info, namespaces, active }: SchemaTreeProps) {
  const [needle, setNeedle] = useState("");
  const open = useOpenTab(info.id);
  const tabs = useWorkspace((state) => state.tabs[info.id]);
  return (
    <aside className="flex min-h-0 flex-col border-r-[0.5px] border-line bg-panel-solid">
      <div className="flex items-center gap-2.5 px-4 pt-3 pb-2">
        <Tile logo={engineLogo(info.engine, info.provider)} icon="data" />
        <span className="min-w-0">
          <b className="block truncate font-semibold text-ink">{info.name}</b>
          <span className="block truncate text-12 text-ink-3">{info.version}</span>
        </span>
      </div>
      <SearchField
        value={needle}
        onChange={setNeedle}
        placeholder="Find a table or column"
        className="mx-2.5 mb-1.5"
      />
      <nav aria-label="Tables" className="min-h-0 flex-1 overflow-auto px-2 pt-0.5 pb-3">
        {namespaces.map((namespace, index) => (
          <Group
            key={namespace.name}
            namespace={namespace}
            first={index === 0}
            active={active}
            needle={needle.trim().toLowerCase()}
            onOpen={(table) => open(tableTab(tableKey(table)))}
          />
        ))}
      </nav>
      <div className="shrink-0 border-t-[0.5px] border-line px-2 pt-1.5 pb-2.5">
        {info.capabilities.sql ? (
          <button type="button" className={rowClass} onClick={() => open(nextQueryTab(tabs ?? []))}>
            <IconSql aria-hidden />
            New query
          </button>
        ) : null}
        <button
          type="button"
          className={rowClass}
          onClick={() => open({ key: "diagram", kind: "diagram", title: "Schema diagram" })}
        >
          <IconSchema aria-hidden />
          Schema diagram
        </button>
        <button
          type="button"
          className={rowClass}
          onClick={() => open({ key: "history", kind: "history", title: "History" })}
        >
          <IconHistory aria-hidden />
          History
        </button>
      </div>
    </aside>
  );
}
