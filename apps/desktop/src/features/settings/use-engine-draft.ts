import { create } from "zustand";

import { useEngineStatus, useSaveEngineConfig } from "@/features/engine/api";
import type { EngineConfig } from "@/lib/ipc/bindings";

import { describeChanges } from "./model";

type DraftStore = {
  draft: EngineConfig | null;
  /** Saved since the engine last started, so the running engine is out of date. */
  saved: boolean;
  setDraft: (draft: EngineConfig | null) => void;
  markSaved: (saved: boolean) => void;
};

/** Kept outside the panes so moving between Engine, Kubernetes and Docker keeps unsaved edits. */
const useDraftStore = create<DraftStore>((set) => ({
  draft: null,
  saved: false,
  setDraft: (draft) => set({ draft }),
  markSaved: (saved) => set({ saved }),
}));

/** Engine settings being edited: the saved `colima.yaml` plus any unsaved changes. */
export function useEngineDraft() {
  const { data: status } = useEngineStatus();
  const draft = useDraftStore((state) => state.draft);
  const savedSinceStart = useDraftStore((state) => state.saved);
  const setDraft = useDraftStore((state) => state.setDraft);
  const markSaved = useDraftStore((state) => state.markSaved);
  const save = useSaveEngineConfig();
  const saved = status?.config;
  const config = draft ?? saved;
  return {
    status,
    config,
    changes: saved && draft ? describeChanges(saved, draft) : [],
    update: (patch: Partial<EngineConfig>) => {
      if (config) {
        setDraft({ ...config, ...patch });
      }
    },
    discard: () => setDraft(null),
    save: () => {
      if (draft) {
        save.mutate(draft, {
          onSuccess: () => {
            setDraft(null);
            markSaved(true);
          },
        });
      }
    },
    saving: save.isPending,
    savedSinceStart,
    clearSaved: () => markSaved(false),
  };
}
