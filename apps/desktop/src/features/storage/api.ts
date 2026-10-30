import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Channel } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { create } from "zustand";

import { queryKeys } from "@/app/query-keys";
import { formatBytes } from "@/lib/format";
import { type CleanUpReport, commands, type MoveEvent } from "@/lib/ipc/bindings";
import { errorMessage } from "@/lib/ipc/errors";

const keys = {
  location: [...queryKeys.storage, "location"],
  usage: [...queryKeys.storage, "usage"],
  disk: [...queryKeys.storage, "disk"],
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

/** What the containers VM's disk files really take on the Mac; `null` on another Docker engine. */
export function useEngineDisk() {
  return useQuery({
    queryKey: keys.disk,
    queryFn: commands.storageEngineDisk,
    refetchInterval: 15_000,
  });
}

/** Trims the running VMs so space already freed inside them goes back to the Mac. */
export function useReturnFreeSpace() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: commands.storageReturnFreeSpace,
    onSuccess: (returned) =>
      toast.success(
        returned.returnedBytes > 0
          ? `Returned ${formatBytes(returned.returnedBytes)} to the Mac`
          : "The engine's disk had no free space to return",
      ),
    onError: (error) =>
      toast.error("The free space didn't go back to the Mac", {
        description: errorMessage(error),
      }),
    onSettled: () => client.invalidateQueries({ queryKey: keys.disk }),
  });
}

/**
 * Toasts what a clean-up freed inside the engine and how much of it went back to the Mac, and
 * warns when the engine's disk didn't shrink.
 */
export function announceCleanUp(report: CleanUpReport, removed: string) {
  const returned =
    report.returnedBytes > 0 ? `, ${formatBytes(report.returnedBytes)} back to the Mac` : "";
  toast.success(`Freed ${formatBytes(report.reclaimedBytes)}`, {
    description: `${removed}${returned}`,
  });
  if (report.trimError) {
    toast.warning("The engine's disk didn't shrink on the Mac", {
      description: report.trimError,
    });
  }
}

export type CleanUp = "images" | "containers" | "volumes" | "buildCache";

const CLEAN_UPS: Record<CleanUp, { run: () => Promise<CleanUpReport>; done: string }> = {
  images: { run: () => commands.imagesPrune(true), done: "Unused images removed" },
  containers: { run: commands.containersPrune, done: "Stopped containers removed" },
  volumes: { run: commands.volumesPrune, done: "Unused volumes removed" },
  buildCache: { run: commands.buildCachePrune, done: "Build cache cleared" },
};

/** Runs one clean-up and says what it freed. */
export function useCleanUp() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (kind: CleanUp) => CLEAN_UPS[kind].run(),
    onSuccess: (report, kind) => announceCleanUp(report, CLEAN_UPS[kind].done),
    onError: (error) => toast.error("Clean-up failed", { description: errorMessage(error) }),
    onSettled: () => {
      client.invalidateQueries({ queryKey: keys.usage }).catch(() => undefined);
      client.invalidateQueries({ queryKey: keys.disk }).catch(() => undefined);
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
