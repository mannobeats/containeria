import { create } from "zustand";

import type { Table } from "@/lib/ipc/bindings";

type TableAction =
  | { kind: "import"; table: Table; path: string }
  | { kind: "truncate" | "drop"; table: Table };

type TableActionState = {
  action: TableAction | null;
  show: (action: TableAction) => void;
  close: () => void;
};

/** The sheet a table's menu asked for, from the schema tree or the table's own toolbar. */
export const useTableAction = create<TableActionState>((set) => ({
  action: null,
  show: (action) => set({ action }),
  close: () => set({ action: null }),
}));
