import { create } from "zustand";
import { persist } from "zustand/middleware";

type UiState = {
  sidebarCollapsed: boolean;
  paletteOpen: boolean;
  shortcutsOpen: boolean;
  /** The offer to install the command-line tools was turned down; Settings still has it. */
  toolsDeclined: boolean;
  toggleSidebar: () => void;
  setPaletteOpen: (open: boolean) => void;
  setShortcutsOpen: (open: boolean) => void;
  declineTools: () => void;
};

export const useUi = create<UiState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      paletteOpen: false,
      shortcutsOpen: false,
      toolsDeclined: false,
      toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
      setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),
      declineTools: () => set({ toolsDeclined: true }),
    }),
    {
      name: "contena.ui",
      partialize: (state) => ({
        sidebarCollapsed: state.sidebarCollapsed,
        toolsDeclined: state.toolsDeclined,
      }),
    },
  ),
);
