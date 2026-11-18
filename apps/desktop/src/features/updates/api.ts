import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Channel } from "@tauri-apps/api/core";
import { useState } from "react";

import { type AppUpdate, commands, events, type UpdateProgress } from "@/lib/ipc/bindings";
import { useTauriEvent } from "@/lib/ipc/use-tauri-event";

const keys = { found: ["update", "found"], check: ["update", "check"] } as const;

/** The update the app found by itself, kept current as it finds one. Never asks the server. */
export function useUpdateFound() {
  const client = useQueryClient();
  useTauriEvent(events.updateAvailable, (update) => client.setQueryData(keys.found, update));
  return useQuery({ queryKey: keys.found, queryFn: commands.updateFound });
}

/** Asks the release server for a newer version each time a view that shows the answer opens. */
export function useUpdateCheck() {
  const client = useQueryClient();
  return useQuery({
    queryKey: keys.check,
    queryFn: async (): Promise<AppUpdate | null> => {
      const update = await commands.updateCheck();
      client.setQueryData(keys.found, update);
      return update;
    },
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
}

/** Installs the update found and restarts Contena; `progress` is how much has been fetched. */
export function useInstallUpdate() {
  const client = useQueryClient();
  const [progress, setProgress] = useState<UpdateProgress | null>(null);
  const install = useMutation({
    mutationFn: () => commands.updateInstall(new Channel<UpdateProgress>(setProgress)),
    // It only comes back when nothing was installed: what is known of updates is out of date.
    onSettled: () => {
      setProgress(null);
      return client.invalidateQueries({ queryKey: ["update"] });
    },
  });
  return { install, progress };
}
