import { create } from "zustand";

import type { Connection } from "@/lib/ipc/bindings";

type ConnectionSheetState = {
  open: boolean;
  /** The connection being edited; none for a new one. */
  connection: Connection | undefined;
  /** Counts openings, so each one starts the form afresh from the connection it was given. */
  opens: number;
  show: (connection?: Connection) => void;
  setOpen: (open: boolean) => void;
};

/** The connection sheet opens from the data page and the File menu. */
export const useConnectionSheet = create<ConnectionSheetState>((set) => ({
  open: false,
  connection: undefined,
  opens: 0,
  show: (connection) => set((state) => ({ open: true, connection, opens: state.opens + 1 })),
  setOpen: (open) => set({ open }),
}));
