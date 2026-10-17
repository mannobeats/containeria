import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { open, save } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { useTransition } from "react";
import { toast } from "sonner";

import { queryKeys } from "@/app/query-keys";
import { useToastedMutation } from "@/app/use-toasted-mutation";
import { isServing, useEngineStatus } from "@/features/engine/api";
import { formatBytes } from "@/lib/format";
import { commands } from "@/lib/ipc/bindings";
import { errorMessage } from "@/lib/ipc/errors";

export function useVolumes() {
  const { data: engine } = useEngineStatus();
  return useQuery({
    queryKey: queryKeys.volumes,
    queryFn: commands.volumesList,
    enabled: isServing(engine?.phase),
  });
}

export function useVolumeFiles(name: string, path: string) {
  return useQuery({
    queryKey: [...queryKeys.volumes, name, "files", path],
    queryFn: () => commands.volumeFiles(name, path),
  });
}

export function useCreateVolume() {
  return useToastedMutation({
    run: (name: string) => commands.volumeCreate(name),
    done: (name) => `Created ${name}`,
    failed: "The volume wasn't created",
    invalidates: queryKeys.volumes,
  });
}

export function useRemoveVolume() {
  return useToastedMutation({
    run: (name: string) => commands.volumeRemove(name),
    done: (name) => `Deleted ${name}`,
    failed: "The volume wasn't deleted",
    invalidates: queryKeys.volumes,
  });
}

export function useCloneVolume() {
  return useToastedMutation({
    run: ({ source, target }: { source: string; target: string }) =>
      commands.volumeClone(source, target),
    done: ({ target }) => `Cloned into ${target}`,
    failed: "The volume wasn't cloned",
    invalidates: queryKeys.volumes,
  });
}

export function usePruneVolumes() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: commands.volumesPrune,
    onSuccess: (report) =>
      toast.success(`Freed ${formatBytes(report.reclaimedBytes)}`, {
        description: `${report.removed} volumes deleted`,
      }),
    onError: (error) => toast.error("Clean-up failed", { description: errorMessage(error) }),
    onSettled: () => client.invalidateQueries({ queryKey: queryKeys.volumes }),
  });
}

function reveal(path: string) {
  return { label: "Show in Finder", onClick: () => revealItemInDir(path).catch(() => undefined) };
}

/**
 * Copies something out of the engine onto the Mac. It changes no cached engine state, so it runs as
 * a React transition rather than a query mutation.
 */
function useSaveToMac<T>(save: (input: T) => Promise<string | null>, failure: string) {
  const [saving, startTransition] = useTransition();
  const run = (input: T) =>
    startTransition(async () => {
      try {
        const saved = await save(input);
        if (saved) {
          toast.success("Saved", { description: saved, action: reveal(saved) });
        }
      } catch (error) {
        toast.error(failure, { description: errorMessage(error) });
      }
    });
  return { run, saving };
}

/** Asks where to save, then writes the volume there as a `.tar.gz`. */
export function useBackupVolume() {
  return useSaveToMac(async (name: string) => {
    const date = new Date().toISOString().slice(0, 10);
    const destination = await save({
      defaultPath: `${name}-${date}.tar.gz`,
      filters: [{ name: "Backup", extensions: ["gz"] }],
    });
    if (destination) {
      await commands.volumeBackup(name, destination);
    }
    return destination;
  }, "The backup failed");
}

/** Asks for a folder, then copies a file or folder out of the volume into it. */
export function useDownloadFromVolume() {
  return useSaveToMac(async ({ name, path }: { name: string; path: string }) => {
    const folder = await open({ directory: true, title: "Choose where to save" });
    return folder ? commands.volumeDownload(name, path, folder) : null;
  }, "The copy failed");
}
