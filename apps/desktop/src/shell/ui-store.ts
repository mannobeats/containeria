import { create } from "zustand";
import { persist } from "zustand/middleware";

type UiState = {
  sidebarCollapsed: boolean;
  paletteOpen: boolean;
  toggleSidebar: () => void;
  setPaletteOpen: (open: boolean) => void;
};

export const useUi = create<UiState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      paletteOpen: false,
      toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
    }),
    {
      name: "containeria.ui",
      partialize: (state) => ({ sidebarCollapsed: state.sidebarCollapsed }),
    },
  ),
);
