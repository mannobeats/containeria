import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { create } from "zustand";

import { queryKeys } from "@/app/query-keys";
import { commands, type RunSpec } from "@/lib/ipc/bindings";

type RunSheetState = { open: boolean; show: () => void; hide: () => void };

/** The Run container sheet opens from the containers list, ⌘N and the command palette. */
export const useRunSheet = create<RunSheetState>((set) => ({
  open: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false }),
}));

/** Docker Hub matches for what's typed in the image field, once there's enough to search for. */
export function useHubSearch(term: string) {
  const query = term.trim();
  return useQuery({
    queryKey: ["hub", query],
    queryFn: () => commands.hubSearch(query),
    enabled: query.length >= 2 && !query.includes(":"),
    staleTime: 60_000,
  });
}

export function useRunContainer() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (spec: RunSpec) => commands.containerRun(spec),
    onSettled: () => client.invalidateQueries({ queryKey: queryKeys.containers }),
  });
}
