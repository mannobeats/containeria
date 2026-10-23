import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { open, save } from "@tauri-apps/plugin-dialog";
import { useState } from "react";
import { toast } from "sonner";

import { queryKeys } from "@/app/query-keys";
import { isServing, useEngineStatus } from "@/features/engine/api";
import { commands, type LogEntry, type StatsSample } from "@/lib/ipc/bindings";
import type { OpenShell } from "@/lib/ipc/connect-shell";
import { errorMessage } from "@/lib/ipc/errors";
import { useStream } from "@/lib/ipc/use-stream";

import { appendLines, type LogLine } from "./logs-model";
import { appendSample, emptyHistory } from "./stats-model";

const detailKey = (id: string) => [...queryKeys.containers, id, "details"];

export function useContainerDetails(id: string) {
  const { data: engine } = useEngineStatus();
  return useQuery({
    queryKey: detailKey(id),
    queryFn: () => commands.containerDetails(id),
    enabled: isServing(engine?.phase),
  });
}

/** Charts' rolling history from the live stats stream, while `running`. */
export function useStatsHistory(id: string, running: boolean) {
  const [history, setHistory] = useState(emptyHistory);
  useStream<StatsSample>(
    running ? `stats:${id}` : null,
    (channel) => commands.containerStats(id, channel),
    (sample) => setHistory((current) => appendSample(current, sample, Date.now() / 1000)),
  );
  return history;
}

/** The last 1000 lines, then new ones as they arrive. `clear` hides what's there so far. */
export function useLogs(id: string) {
  const [lines, setLines] = useState<LogLine[]>([]);
  useStream<LogEntry[]>(
    `logs:${id}`,
    (channel) => commands.containerLogs(id, 1000, channel),
    (batch) => setLines((current) => appendLines(current, batch)),
  );
  return { lines, clear: () => setLines([]) };
}

export function useFiles(id: string, path: string) {
  return useQuery({
    queryKey: [...queryKeys.containers, id, "files", path],
    queryFn: () => commands.containerFiles(id, path),
  });
}

const fileName = (path: string) => path.split("/").filter(Boolean).pop() ?? "root";

/** Asks where to save, then copies a file (or a folder, as a tar) out of the container. */
export function useDownload(id: string) {
  return useMutation({
    mutationFn: async ({ path, folder }: { path: string; folder: boolean }) => {
      const destination = await save({
        defaultPath: folder ? `${fileName(path)}.tar` : fileName(path),
      });
      if (destination) {
        await commands.containerDownload(id, path, destination);
      }
      return destination;
    },
    onSuccess: (destination) =>
      destination ? toast.success("Saved", { description: destination }) : undefined,
    onError: (error) => toast.error("Couldn't save the file", { description: errorMessage(error) }),
  });
}

/** Copies Mac files into `directory`; with no `sources`, asks for them first. */
export function useUpload(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ directory, sources }: { directory: string; sources?: string[] }) => {
      const picked = sources ?? (await open({ multiple: true })) ?? [];
      if (picked.length > 0) {
        await commands.containerUpload(id, directory, picked);
      }
      return picked.length;
    },
    onSuccess: (count) =>
      count > 0
        ? toast.success(count === 1 ? "Copied 1 item" : `Copied ${count} items`)
        : undefined,
    onError: (error) =>
      toast.error("Couldn't copy into the container", { description: errorMessage(error) }),
    onSettled: () => client.invalidateQueries({ queryKey: [...queryKeys.containers, id, "files"] }),
  });
}

export function useExport(id: string, name: string) {
  return useMutation({
    mutationFn: async () => {
      const destination = await save({ defaultPath: `${name}.tar` });
      if (destination) {
        await commands.containerExport(id, destination);
      }
      return destination;
    },
    onSuccess: (destination) =>
      destination ? toast.success("Exported", { description: destination }) : undefined,
    onError: (error) =>
      toast.error("Couldn't export the filesystem", { description: errorMessage(error) }),
  });
}

export function useRename(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => commands.containerRename(id, name),
    onSuccess: (_, name) => toast.success(`Renamed to ${name}`),
    onError: (error) =>
      toast.error("Couldn't rename the container", { description: errorMessage(error) }),
    onSettled: () => client.invalidateQueries({ queryKey: queryKeys.containers }),
  });
}

export function useCommit(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (reference: string) => commands.containerCommit(id, reference),
    onSuccess: (_, reference) => toast.success(`Saved as ${reference}`),
    onError: (error) =>
      toast.error("Couldn't save the image", { description: errorMessage(error) }),
    onSettled: () => client.invalidateQueries({ queryKey: queryKeys.images }),
  });
}

/** A shell in the container, or busybox beside it when `debug` is set. */
export const containerShell =
  (id: string, debug: boolean): OpenShell =>
  (cols, rows, channel) =>
    commands.containerShell(id, debug, cols, rows, channel);
