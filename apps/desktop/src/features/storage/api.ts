import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Channel } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { create } from "zustand";

import { queryKeys } from "@/app/query-keys";
import { formatBytes } from "@/lib/format";
import { commands, type MoveEvent, type PruneReport } from "@/lib/ipc/bindings";
import { errorMessage } from "@/lib/ipc/errors";

const keys = {
  location: [...queryKeys.storage, "location"],
  usage: [...queryKeys.storage, "usage"],
} as const;

export function useDataLocation() {
  return useQuery({ queryKey: keys.location, queryFn: commands.storageLocation });
}

/**
 * Disk use inside the engine; there's none to show while it's stopped. Kubernetes health checks
 * send Docker events every few seconds, so this polls slowly instead of following them.
 */
export function useDiskUsage() {
  return useQuery({
    queryKey: keys.usage,
    queryFn: commands.storageUsage,
    retry: false,
    refetchInterval: 15_000,
  });
}

export type CleanUp = "images" | "containers" | "volumes" | "buildCache";

const CLEAN_UPS: Record<CleanUp, { run: () => Promise<PruneReport>; what: string }> = {
  images: { run: () => commands.imagesPrune(true), what: "unused images" },
  containers: { run: commands.containersPrune, what: "stopped containers" },
  volumes: { run: commands.volumesPrune, what: "unused volumes" },
  buildCache: { run: commands.buildCachePrune, what: "build cache" },
};

/** Runs one clean-up and says what it freed. */
export function useCleanUp() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (kind: CleanUp) => CLEAN_UPS[kind].run(),
    onSuccess: (report, kind) =>
      toast.success(
        `Removed ${CLEAN_UPS[kind].what}, freeing ${formatBytes(report.reclaimedBytes)}`,
      ),
    onError: (error) => toast.error("Clean-up failed", { description: errorMessage(error) }),
    onSettled: () => {
      client.invalidateQueries({ queryKey: keys.usage }).catch(() => undefined);
      client.invalidateQueries({ queryKey: queryKeys.images }).catch(() => undefined);
      client.invalidateQueries({ queryKey: queryKeys.volumes }).catch(() => undefined);
      client.invalidateQueries({ queryKey: queryKeys.containers }).catch(() => undefined);
    },
  });
}

/** Where a move is, for the pane to show. */
export type MoveState =
  | { step: "stopping" | "starting" }
  | { step: "copying"; copied: number; total: number }
  | null;

/** Where the data would land for `folder`, or `null` after saying why it can't go there. */
export async function checkDestination(folder: string | null): Promise<string | null> {
  try {
    return await commands.storageCheck(folder);
  } catch (error) {
    toast.error("The data can't go there", { description: errorMessage(error) });
    return null;
  }
}

/** Outside the pane, so a move still shows after switching to another Settings pane and back. */
const useMove = create<{ state: MoveState }>(() => ({ state: null }));
const setState = (state: MoveState) => useMove.setState({ state });

/** Moves the engine's data, following the steps until it's done. */
export function useMoveData() {
  const client = useQueryClient();
  const state = useMove((move) => move.state);
  const finish = (outcome: { failure: string } | { restartError: string | null }) => {
    setState(null);
    client.invalidateQueries({ queryKey: queryKeys.storage }).catch(() => undefined);
    if ("failure" in outcome) {
      toast.error("The data didn't move", { description: outcome.failure });
    } else if (outcome.restartError) {
      toast.warning("The data moved, but the engine didn't start again", {
        description: outcome.restartError,
      });
    } else {
      toast.success("The engine's data moved");
    }
  };
  const onEvent = (event: MoveEvent) => {
    if (event.kind === "copying") {
      setState({
        step: "copying",
        copied: event.progress.copiedBytes,
        total: event.progress.totalBytes,
      });
    } else if (event.kind === "stopping" || event.kind === "starting") {
      setState({ step: event.kind });
    } else if (event.kind === "failed") {
      finish({ failure: event.message });
    } else {
      finish({ restartError: event.restartError });
    }
  };
  const start = (folder: string | null) => {
    setState({ step: "stopping" });
    commands
      .storageMove(folder, new Channel<MoveEvent>(onEvent))
      .catch((error: unknown) => finish({ failure: errorMessage(error) }));
  };
  return { state, start };
}
