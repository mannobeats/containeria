import { create } from "zustand";

import type { Filter, Sort } from "@/lib/ipc/bindings";

import { EMPTY_PENDING, type Pending } from "./model";

export type TabKind = "table" | "query" | "diagram" | "history" | "keys";

export type Tab = { key: string; kind: TabKind; title: string };

/** How one table is being looked at: filters, sort, paging and panels. */
export type GridView = {
  filters: Filter[];
  sort: Sort | null;
  page: number;
  size: number;
  structure: boolean;
  inspector: boolean;
};

export const DEFAULT_VIEW: GridView = {
  filters: [],
  sort: null,
  page: 0,
  size: 100,
  structure: false,
  inspector: false,
};

type Workspace = {
  /** Open tabs per connection. */
  tabs: Record<string, Tab[]>;
  /** SQL in each query tab, by `connection|tab`. */
  sql: Record<string, string>;
  /** Grid views and staged changes, by `connection|table`. */
  views: Record<string, GridView>;
  pending: Record<string, Pending>;
  openTab: (connection: string, tab: Tab) => void;
  closeTab: (connection: string, key: string) => void;
  setSql: (key: string, sql: string) => void;
  setView: (key: string, change: Partial<GridView>) => void;
  setPending: (key: string, update: (pending: Pending) => Pending) => void;
};

export const useWorkspace = create<Workspace>((set) => ({
  tabs: {},
  sql: {},
  views: {},
  pending: {},
  openTab: (connection, tab) =>
    set((state) => {
      const tabs = state.tabs[connection] ?? [];
      return tabs.some((open) => open.key === tab.key)
        ? state
        : { tabs: { ...state.tabs, [connection]: [...tabs, tab] } };
    }),
  closeTab: (connection, key) =>
    set((state) => ({
      tabs: {
        ...state.tabs,
        [connection]: (state.tabs[connection] ?? []).filter((tab) => tab.key !== key),
      },
    })),
  setSql: (key, sql) => set((state) => ({ sql: { ...state.sql, [key]: sql } })),
  setView: (key, change) =>
    set((state) => ({
      views: { ...state.views, [key]: { ...(state.views[key] ?? DEFAULT_VIEW), ...change } },
    })),
  setPending: (key, update) =>
    set((state) => ({
      pending: { ...state.pending, [key]: update(state.pending[key] ?? EMPTY_PENDING) },
    })),
}));

/** The next free "Query n" tab for a connection. */
export function nextQueryTab(tabs: Tab[]): Tab {
  const used = new Set(tabs.filter((tab) => tab.kind === "query").map((tab) => tab.key));
  let number = 1;
  while (used.has(`query:${number}`)) {
    number += 1;
  }
  return { key: `query:${number}`, kind: "query", title: `Query ${number}` };
}
