import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Channel } from "@tauri-apps/api/core";
import { useState } from "react";

import { queryKeys } from "@/app/query-keys";
import {
  commands,
  type ImportProgress,
  type ItemKind,
  type MigrationPlan,
  type MigrationSource,
} from "@/lib/ipc/bindings";

export function useMigrationSources() {
  return useQuery({ queryKey: ["migration", "sources"], queryFn: commands.migrationSources });
}

export function useInventory(source: MigrationSource | null) {
  return useQuery({
    queryKey: ["migration", "inventory", source],
    queryFn: () => commands.migrationInventory(source ?? "dockerDesktop"),
    enabled: source !== null,
  });
}

/** `image:redis:8`: progress is tracked per kind and item, since names can repeat across kinds. */
export function progressKey(kind: ItemKind, item: string): string {
  return `${kind}:${item}`;
}

/** Brings the chosen items over and tracks each one's progress. */
export function useMigration() {
  const [progress, setProgress] = useState<Record<string, ImportProgress>>({});
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: ({ source, plan }: { source: MigrationSource; plan: MigrationPlan }) =>
      commands.migrationImport(
        source,
        plan,
        new Channel<ImportProgress>((update) =>
          setProgress((current) => ({
            ...current,
            [progressKey(update.kind, update.item)]: update,
          })),
        ),
      ),
    onSettled: () => {
      for (const key of [queryKeys.images, queryKeys.volumes, queryKeys.containers]) {
        client.invalidateQueries({ queryKey: key }).catch(() => undefined);
      }
    },
  });
  return { ...mutation, progress };
}
