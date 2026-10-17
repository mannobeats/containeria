import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Channel } from "@tauri-apps/api/core";
import { useState } from "react";

import { queryKeys } from "@/app/query-keys";
import { commands, type ImportProgress } from "@/lib/ipc/bindings";

export function useDockerDesktop() {
  return useQuery({ queryKey: ["docker-desktop"], queryFn: commands.dockerDesktopDetect });
}

/** Copies images from Docker Desktop and tracks each one's progress by reference. */
export function useImportImages() {
  const [progress, setProgress] = useState<Record<string, ImportProgress>>({});
  const client = useQueryClient();
  const mutation = useMutation({
    onSettled: () => client.invalidateQueries({ queryKey: queryKeys.images }),
    mutationFn: (references: string[]) =>
      commands.dockerDesktopImportImages(
        references,
        new Channel<ImportProgress>((update) =>
          setProgress((current) => ({ ...current, [update.reference]: update })),
        ),
      ),
  });
  return { ...mutation, progress };
}
