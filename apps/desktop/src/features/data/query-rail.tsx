import { IconBookmark } from "@tabler/icons-react";
import { useState } from "react";

import { copyText } from "@/lib/clipboard";
import { formatRelative } from "@/lib/format";
import type { HistoryEntry, SavedQuery } from "@/lib/ipc/bindings";
import { ConfirmSheet } from "@/ui/confirm-sheet";
import { ContextMenu } from "@/ui/menu";

import { useDeleteQuery } from "./api";
import { SqlText } from "./sql-text";
import { useOpenQuery } from "./use-open-query";

type QueryRailProps = { history: HistoryEntry[]; saved: SavedQuery[] };

/** Recent and saved queries beside the connections, one click from reopening. */
export function QueryRail({ history, saved }: QueryRailProps) {
  const openQuery = useOpenQuery();
  const remove = useDeleteQuery();
  const [deleting, setDeleting] = useState<SavedQuery | null>(null);
  return (
    <aside className="min-w-0 pt-1">
      <h2 className="m-0 mb-2.5 text-14 font-semibold text-ink">Recent queries</h2>
      {history.length === 0 ? (
        <p className="m-0 text-12 text-ink-3">Queries you run show up here.</p>
      ) : null}
      {history.slice(0, 5).map((entry) => (
        <ContextMenu
          key={entry.id}
          entries={[
            { label: "Open", onSelect: () => openQuery(entry.connectionId, entry.sql) },
            { kind: "separator" },
            { label: "Copy SQL", onSelect: () => copyText("SQL", entry.sql) },
          ]}
        >
          <button
            type="button"
            onClick={() => openQuery(entry.connectionId, entry.sql)}
            className="mb-2 flex w-full flex-col gap-1.5 rounded-md bg-fill px-3 py-2.5 text-left transition-colors duration-140 hover:bg-hover data-[state=open]:bg-hover"
          >
            <SqlText
              sql={entry.sql.split("\n").slice(0, 3).join("\n")}
              className="line-clamp-3 text-mono-12"
            />
            <span className="flex text-12 text-ink-3">
              {entry.connectionName}
              <span className="ml-auto tabular">{formatRelative(entry.atMs / 1000)}</span>
            </span>
          </button>
        </ContextMenu>
      ))}
      <h2 className="m-0 mt-5 mb-2 text-14 font-semibold text-ink">Saved queries</h2>
      {saved.length === 0 ? (
        <p className="m-0 text-12 text-ink-3">Save a query from the editor to keep it here.</p>
      ) : null}
      {saved.map((query) => {
        const open = () =>
          query.connectionId ? openQuery(query.connectionId, query.sql) : undefined;
        return (
          <ContextMenu
            key={query.id}
            entries={[
              { label: "Open", disabled: !query.connectionId, onSelect: open },
              { kind: "separator" },
              { label: "Copy SQL", onSelect: () => copyText("SQL", query.sql) },
              { kind: "separator" },
              { label: "Delete…", danger: true, onSelect: () => setDeleting(query) },
            ]}
          >
            <button
              type="button"
              aria-disabled={!query.connectionId}
              onClick={open}
              className="flex h-[30px] w-full items-center gap-2 rounded-sm px-2 text-left text-13 text-ink transition-colors duration-140 hover:bg-hover aria-disabled:opacity-50 data-[state=open]:bg-hover"
            >
              <IconBookmark className="text-ink-3" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{query.name}</span>
            </button>
          </ContextMenu>
        );
      })}
      <ConfirmSheet
        open={deleting !== null}
        onOpenChange={(open) => (open ? undefined : setDeleting(null))}
        title={`Delete “${deleting?.name ?? "query"}”?`}
        action="Delete query"
        onConfirm={() => {
          if (deleting) {
            remove.mutate(deleting);
          }
          setDeleting(null);
        }}
      >
        The saved query is removed. Its runs stay in the history.
      </ConfirmSheet>
    </aside>
  );
}
