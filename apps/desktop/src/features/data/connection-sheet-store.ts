import { create } from "zustand";

import type { Connection } from "@/lib/ipc/bindings";

type ConnectionSheetState = {
  open: boolean;
  /** The connection being edited; none for a new one. */
  connection: Connection | undefined;
  show: (connection?: Connection) => void;
  setOpen: (open: boolean) => void;
};

/** The connection sheet opens from the data page and the File menu. */
export const useConnectionSheet = create<ConnectionSheetState>((set) => ({
  open: false,
  connection: undefined,
  show: (connection) => set({ open: true, connection }),
  setOpen: (open) => set({ open }),
}));
