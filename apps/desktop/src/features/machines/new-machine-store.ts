import { create } from "zustand";

/** The New machine sheet opens from the machines page and the File menu. */
export const useNewMachineSheet = create<{ open: boolean; setOpen: (open: boolean) => void }>(
  (set) => ({ open: false, setOpen: (open) => set({ open }) }),
);
