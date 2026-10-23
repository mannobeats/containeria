import { create } from "zustand";

type ImageSheet = "pull" | "prune" | "build";

/** Where a build starts: the folder sent to the builder and the Dockerfile in it. */
export type BuildFrom = { context: string; dockerfile: string };

/** Which sheet the images page shows, so the command palette and a drop can open one too. */
export const useImageSheet = create<{
  sheet: ImageSheet | null;
  build: BuildFrom | null;
  setSheet: (sheet: ImageSheet | null) => void;
  openBuild: (from?: BuildFrom) => void;
}>((set) => ({
  sheet: null,
  build: null,
  setSheet: (sheet) => set(sheet === "build" ? { sheet, build: null } : { sheet }),
  openBuild: (from) => set({ sheet: "build", build: from ?? null }),
}));
