import { create } from "zustand";

type ImageSheet = "pull" | "prune";

/** Which sheet the images page shows, so the command palette can open one too. */
export const useImageSheet = create<{
  sheet: ImageSheet | null;
  setSheet: (sheet: ImageSheet | null) => void;
}>((set) => ({
  sheet: null,
  setSheet: (sheet) => set({ sheet }),
}));
