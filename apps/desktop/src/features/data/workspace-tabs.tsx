import {
  IconHistory,
  IconKey,
  IconPlus,
  IconSchema,
  IconSql,
  IconTable,
  IconX,
} from "@tabler/icons-react";
import { Link, useNavigate } from "@tanstack/react-router";
import clsx from "clsx";
import { useState } from "react";

import type { ServerInfo } from "@/lib/ipc/bindings";
import { ConfirmSheet } from "@/ui/confirm-sheet";
import { IconAction } from "@/ui/icon-action";
import { ContextMenu } from "@/ui/menu";

import { EMPTY_PENDING, pendingCount } from "./model";
import { useOpenTab } from "./tabs";
import { nextQueryTab, type Tab, type TabKind, useWorkspace } from "./workspace-store";

const ICONS: Record<TabKind, typeof IconTable> = {
  table: IconTable,
  query: IconSql,
  diagram: IconSchema,
  history: IconHistory,
  keys: IconKey,
};

type TabsProps = { info: ServerInfo; tabs: Tab[]; active: string | undefined };

/** The open tables and queries of one connection, like browser tabs. */
export function WorkspaceTabs({ info, tabs, active }: TabsProps) {
  const navigate = useNavigate();
  const open = useOpenTab(info.id);
  const closeTab = useWorkspace((state) => state.closeTab);
  const pending = useWorkspace((state) => state.pending);
  const setPending = useWorkspace((state) => state.setPending);
  const [discarding, setDiscarding] = useState<Tab | null>(null);
  const changes = (tab: Tab) =>
    tab.kind === "table"
      ? pendingCount(pending[`${info.id}|${tab.key.slice(6)}`] ?? EMPTY_PENDING)
      : 0;
  const close = (tab: Tab) => {
    closeTab(info.id, tab.key);
    if (tab.key === active) {
      const next = tabs.filter((other) => other.key !== tab.key).at(-1);
      navigate({
        to: "/data/$connection",
        params: { connection: info.id },
        search: next ? { tab: next.key } : {},
      }).catch(() => undefined);
    }
  };
  const ask = (tab: Tab) => (changes(tab) > 0 ? setDiscarding(tab) : close(tab));
  /** Tabs with staged changes stay open: closing them would throw the changes away unasked. */
  const closeOthers = (keep: Tab) => {
    for (const other of tabs) {
      if (other.key !== keep.key && changes(other) === 0) {
        closeTab(info.id, other.key);
      }
    }
    if (keep.key !== active) {
      navigate({
        to: "/data/$connection",
        params: { connection: info.id },
        search: { tab: keep.key },
      }).catch(() => undefined);
    }
  };
  return (
    <div
      role="tablist"
      aria-label="Open tabs"
      className="flex h-9 shrink-0 items-end gap-px overflow-x-auto border-b-[0.5px] border-line bg-panel-solid px-2 [scrollbar-width:none]"
    >
      {tabs.map((tab) => {
        const Icon = ICONS[tab.kind];
        const count = changes(tab);
        const selected = tab.key === active;
        return (
          <ContextMenu
            key={tab.key}
            entries={[
              { label: "Close tab", onSelect: () => ask(tab) },
              {
                label: "Close other tabs",
                disabled: tabs.length < 2,
                onSelect: () => closeOthers(tab),
              },
            ]}
          >
            <span
              className={clsx(
                "group/tab relative inline-flex h-[30px] max-w-[220px] shrink-0 items-center gap-1.5 rounded-t-[7px] pr-1.5 pl-2.5 text-12 font-medium transition-colors duration-140",
                selected
                  ? "bg-bg text-ink shadow-[0_0_0_0.5px_var(--line),0_1px_0_var(--bg)] [&>a_.tabler-icon]:text-brand"
                  : "text-ink-3 hover:bg-hover hover:text-ink data-[state=open]:bg-hover",
              )}
            >
              <Link
                role="tab"
                aria-selected={selected}
                to="/data/$connection"
                params={{ connection: info.id }}
                search={{ tab: tab.key }}
                className="inline-flex min-w-0 items-center gap-1.5 text-inherit no-underline [&_.tabler-icon]:size-3.5"
              >
                <Icon aria-hidden />
                <span className="truncate">{tab.title}</span>
              </Link>
              {count > 0 ? (
                <span className="inline-grid h-4 min-w-4 place-items-center rounded-xs bg-brand-soft px-1 text-[10.5px] font-semibold text-brand-ink tabular">
                  {count}
                </span>
              ) : null}
              <button
                type="button"
                aria-label={`Close ${tab.title}`}
                onClick={() => ask(tab)}
                className="inline-grid size-[18px] place-items-center rounded-xs text-ink-3 opacity-0 transition-opacity duration-140 group-hover/tab:opacity-100 hover:bg-press hover:text-ink focus-visible:opacity-100 [&_.tabler-icon]:size-3"
              >
                <IconX aria-hidden />
              </button>
            </span>
          </ContextMenu>
        );
      })}
      {info.capabilities.query ? (
        <span className="mb-1 ml-1 shrink-0">
          <IconAction label="New query" kbd="⌘T" onClick={() => open(nextQueryTab(tabs))}>
            <IconPlus />
          </IconAction>
        </span>
      ) : null}
      <ConfirmSheet
        open={discarding !== null}
        onOpenChange={(next) => (next ? undefined : setDiscarding(null))}
        title={`Discard changes to ${discarding?.title ?? "this table"}?`}
        action="Discard and close"
        onConfirm={() => {
          if (discarding) {
            setPending(`${info.id}|${discarding.key.slice(6)}`, () => EMPTY_PENDING);
            close(discarding);
          }
          setDiscarding(null);
        }}
      >
        Staged changes in this tab haven't been committed. Closing it throws them away.
      </ConfirmSheet>
    </div>
  );
}
