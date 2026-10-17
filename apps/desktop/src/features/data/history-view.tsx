import { IconBookmark, IconCopy, IconPencil, IconTrash } from "@tabler/icons-react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { useState } from "react";
import { toast } from "sonner";

import { formatRelative } from "@/lib/format";
import type { HistoryEntry, ServerInfo } from "@/lib/ipc/bindings";
import { Button } from "@/ui/button";
import { Chip } from "@/ui/chip";
import { EmptyState } from "@/ui/empty-state";
import { IconAction } from "@/ui/icon-action";
import { SearchField } from "@/ui/search-field";

import { useDeleteQuery, useHistory, useSavedQueries } from "./api";
import { SqlText } from "./sql-text";
import { useOpenQuery } from "./use-open-query";

function Entry({ entry, onOpen }: { entry: HistoryEntry; onOpen: () => void }) {
  return (
    <div className="group/entry border-b-[0.5px] border-line py-3">
      <SqlText sql={entry.sql} className="mb-2" />
      <div className="flex items-center gap-2 text-12 text-ink-3">
        <span>{formatRelative(entry.atMs / 1000)}</span>
        <span className="tabular">
          {entry.rows === null ? "" : `${entry.rows.toLocaleString("en-US")} rows · `}
          {Math.round(entry.elapsedMs)} ms
        </span>
        {entry.error ? <Chip tone="bad">Failed</Chip> : null}
        <span className="ml-auto flex gap-1 opacity-0 transition-opacity duration-140 group-focus-within/entry:opacity-100 group-hover/entry:opacity-100">
          <Button variant="ghost" size="sm" onClick={onOpen}>
            <IconPencil />
            Open in editor
          </Button>
          <IconAction
            label="Copy SQL"
            onClick={() =>
              writeText(entry.sql)
                .then(() => toast("Copied the SQL"))
                .catch(() => undefined)
            }
          >
            <IconCopy />
          </IconAction>
        </span>
      </div>
    </div>
  );
}

/** Everything run on this connection, newest first, and the saved queries beside it. */
export function HistoryView({ info }: { info: ServerInfo }) {
  const { data: history = [] } = useHistory();
  const { data: saved = [] } = useSavedQueries();
  const remove = useDeleteQuery();
  const openQuery = useOpenQuery();
  const [query, setQuery] = useState("");
  const mine = history.filter(
    (entry) =>
      entry.connectionId === info.id &&
      entry.sql.toLowerCase().includes(query.trim().toLowerCase()),
  );
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b-[0.5px] border-line px-3">
        <SearchField
          value={query}
          onChange={setQuery}
          placeholder="Search history"
          className="w-[260px]"
        />
        <span className="text-12 text-ink-3">
          {mine.length} {mine.length === 1 ? "query" : "queries"} on {info.name}
        </span>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_280px]">
        <div className="overflow-auto px-5 pt-2 pb-10">
          {mine.length === 0 ? (
            <EmptyState title={`No queries on ${info.name} yet`}>
              Everything you run is kept here, with its timing and row count.
            </EmptyState>
          ) : (
            mine.map((entry) => (
              <Entry key={entry.id} entry={entry} onOpen={() => openQuery(info.id, entry.sql)} />
            ))
          )}
        </div>
        <aside className="overflow-auto border-l-[0.5px] border-line bg-panel-solid p-4">
          <h3 className="m-0 mb-2 text-13 font-semibold text-ink">Saved queries</h3>
          {saved.map((item) => (
            <div
              key={item.id}
              className="group/saved flex h-[30px] items-center gap-2 rounded-sm px-2 hover:bg-hover"
            >
              <IconBookmark className="text-ink-3" aria-hidden />
              <button
                type="button"
                className="min-w-0 flex-1 truncate text-left text-13 text-ink"
                onClick={() => openQuery(item.connectionId ?? info.id, item.sql)}
              >
                {item.name}
              </button>
              <span className="opacity-0 group-focus-within/saved:opacity-100 group-hover/saved:opacity-100">
                <IconAction label={`Delete ${item.name}`} onClick={() => remove.mutate(item.id)}>
                  <IconTrash />
                </IconAction>
              </span>
            </div>
          ))}
        </aside>
      </div>
    </div>
  );
}
