import { IconKey, IconTrash } from "@tabler/icons-react";
import clsx from "clsx";
import { useState } from "react";

import { copyText } from "@/lib/clipboard";
import type { RedisValue, ServerInfo } from "@/lib/ipc/bindings";
import { Button } from "@/ui/button";
import { Chip } from "@/ui/chip";
import { ConfirmSheet } from "@/ui/confirm-sheet";
import { EmptyState } from "@/ui/empty-state";
import { IconAction } from "@/ui/icon-action";
import { ContextMenu } from "@/ui/menu";
import { SearchField } from "@/ui/search-field";

import { useDeleteRedisKey, useRedisKeys, useRedisValue } from "../api";
import { CellValue } from "../table/cell-value";
import { pretty, ttlText, uniqueKeys } from "./redis-model";

function ValueBody({ value }: { value: RedisValue }) {
  switch (value.kind) {
    case "text":
      return (
        <pre className="m-5 overflow-auto rounded-md bg-fill px-3 py-2.5 font-mono text-mono-13 whitespace-pre-wrap text-ink-2 select-text">
          {pretty(value.value)}
        </pre>
      );
    case "pairs":
      return (
        <table className="w-full border-separate border-spacing-0 text-13 [&_td]:h-8 [&_td]:border-b-[0.5px] [&_td]:border-line [&_td]:px-5">
          <tbody>
            {value.pairs.map(([field, item]) => (
              <tr key={field}>
                <td className="w-1/3 font-mono text-mono-13 text-ink">{field}</td>
                <td className="font-mono text-mono-13">
                  <CellValue value={item} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      );
    case "items":
      return (
        <ol className="m-0 list-none p-0 text-13">
          {value.items
            .map((item, position) => ({ item, position }))
            .map((entry) => (
              <li
                key={entry.position}
                className="flex h-8 items-center gap-4 border-b-[0.5px] border-line px-5 font-mono text-mono-13"
              >
                <span className="w-10 text-right text-ink-3 tabular">{entry.position}</span>
                {entry.item}
              </li>
            ))}
          {value.truncated ? (
            <li className="px-5 py-2 text-12 text-ink-3">Showing the first 500 items.</li>
          ) : null}
        </ol>
      );
    default:
      return <EmptyState title="This key no longer exists" />;
  }
}

function KeyValue({
  info,
  name,
  onDelete,
}: {
  info: ServerInfo;
  name: string;
  onDelete: () => void;
}) {
  const value = useRedisValue(info.id, name);
  return (
    <div className="flex min-h-0 min-w-0 flex-col">
      <div className="flex shrink-0 items-center gap-3 border-b-[0.5px] border-line py-3 pr-3 pl-5">
        <b className="min-w-0 flex-1 truncate font-mono text-14 text-ink">{name}</b>
        <IconAction label="Delete key" disabled={info.readOnly} onClick={onDelete}>
          <IconTrash />
        </IconAction>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {value.data ? <ValueBody value={value.data} /> : null}
      </div>
    </div>
  );
}

/** Keys found with SCAN as you type a pattern, and the selected key's value. */
export function RedisView({ info }: { info: ServerInfo }) {
  const [pattern, setPattern] = useState("*");
  const [selected, setSelected] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const remove = useDeleteRedisKey(info.id);
  const keys = useRedisKeys(info.id, pattern);
  const all = uniqueKeys(keys.data?.pages.flatMap((page) => page.keys) ?? []);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b-[0.5px] border-line px-3">
        <SearchField
          value={pattern}
          onChange={setPattern}
          placeholder="Key pattern, like session:*"
          className="w-[280px]"
        />
        <span className="ml-auto text-12 text-ink-3 tabular">
          {all.length.toLocaleString("en-US")} keys
        </span>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[380px_minmax(0,1fr)]">
        <div className="overflow-auto border-r-[0.5px] border-line px-1.5 py-1">
          {all.map((key) => (
            <ContextMenu
              key={key.key}
              entries={[
                { label: "Open", onSelect: () => setSelected(key.key) },
                { kind: "separator" },
                { label: "Copy Key", onSelect: () => copyText("Key", key.key) },
                { kind: "separator" },
                {
                  label: "Delete…",
                  danger: true,
                  disabled: info.readOnly,
                  onSelect: () => setDeleting(key.key),
                },
              ]}
            >
              <button
                type="button"
                onClick={() => setSelected(key.key)}
                className={clsx(
                  "flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left transition-colors duration-140 hover:bg-hover data-[state=open]:bg-hover",
                  selected === key.key && "bg-select",
                )}
              >
                <Chip tone="line" className="w-[68px] justify-center text-11">
                  {key.kind}
                </Chip>
                <span className="min-w-0 flex-1 truncate font-mono text-mono-12 text-ink">
                  {key.key}
                </span>
                <span className="text-12 text-ink-3 tabular">{ttlText(key.ttlSeconds)}</span>
              </button>
            </ContextMenu>
          ))}
          {keys.hasNextPage ? (
            <Button
              variant="ghost"
              size="sm"
              className="m-2"
              loading={keys.isFetchingNextPage}
              onClick={() => keys.fetchNextPage()}
            >
              Load more
            </Button>
          ) : null}
        </div>
        {selected ? (
          <KeyValue
            key={selected}
            info={info}
            name={selected}
            onDelete={() => setDeleting(selected)}
          />
        ) : (
          <EmptyState
            art={<IconKey className="size-7" aria-hidden />}
            title="Select a key to see its value"
          />
        )}
      </div>
      <ConfirmSheet
        open={deleting !== null}
        onOpenChange={(open) => (open ? undefined : setDeleting(null))}
        title={`Delete ${deleting ?? "this key"}?`}
        action="Delete key"
        onConfirm={() => {
          if (deleting) {
            remove.mutate(deleting, {
              onSuccess: () => setSelected((current) => (current === deleting ? null : current)),
            });
          }
          setDeleting(null);
        }}
      >
        The key and its value are removed right away.
      </ConfirmSheet>
    </div>
  );
}
