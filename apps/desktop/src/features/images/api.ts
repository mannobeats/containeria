import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Channel } from "@tauri-apps/api/core";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { queryKeys } from "@/app/query-keys";
import { isServing, useEngineStatus } from "@/features/engine/api";
import { notifyWhenAway } from "@/features/settings/api";
import { formatBytes } from "@/lib/format";
import { commands, type PullEvent } from "@/lib/ipc/bindings";
import { errorMessage } from "@/lib/ipc/errors";

import { applyPullProgress, type PullLayer } from "./model";

export function useImages() {
  const { data: engine } = useEngineStatus();
  return useQuery({
    queryKey: queryKeys.images,
    queryFn: commands.imagesList,
    enabled: isServing(engine?.phase),
  });
}

export function useImage(id: string) {
  return useQuery({ queryKey: [...queryKeys.images, id], queryFn: () => commands.imageDetail(id) });
}

/** Docker Hub results for the pull sheet; an empty term shows nothing. */
export function useHubSearch(term: string) {
  const trimmed = term.trim();
  return useQuery({
    queryKey: ["hub", trimmed],
    queryFn: () => commands.hubSearch(trimmed),
    enabled: trimmed.length > 1,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
}

function useInvalidateImages() {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: queryKeys.images });
}

export function useRemoveImage() {
  const invalidate = useInvalidateImages();
  return useMutation({
    mutationFn: ({ id }: { id: string; name: string }) => commands.imageRemove(id, false),
    onSuccess: (_, { name }) => toast.success(`Deleted ${name}`),
    onError: (error) =>
      toast.error("The image wasn't deleted", { description: errorMessage(error) }),
    onSettled: invalidate,
  });
}

export function useTagImage() {
  const invalidate = useInvalidateImages();
  return useMutation({
    mutationFn: ({ id, reference }: { id: string; reference: string }) =>
      commands.imageTag(id, reference),
    onSuccess: (_, { reference }) => toast.success("Tag added", { description: reference }),
    onError: (error) => toast.error("The tag wasn't added", { description: errorMessage(error) }),
    onSettled: invalidate,
  });
}

export function usePruneImages() {
  const invalidate = useInvalidateImages();
  return useMutation({
    mutationFn: (all: boolean) => commands.imagesPrune(all),
    onSuccess: (report) =>
      toast.success(`Freed ${formatBytes(report.reclaimedBytes)}`, {
        description: `${report.removed} ${report.removed === 1 ? "image" : "images"} deleted`,
      }),
    onError: (error) => toast.error("Clean-up failed", { description: errorMessage(error) }),
    onSettled: invalidate,
  });
}

type PullState = { reference: string; layers: PullLayer[] } | null;

export type PullOutcome = { reference: string; failure: string | null };

/** Starts a pull and tracks its layers; `cancel` stops it. `onFinished` hears how it ended. */
export function usePull(onFinished: (outcome: PullOutcome) => void) {
  const invalidate = useInvalidateImages();
  const [state, setState] = useState<PullState>(null);
  const stream = useRef<number | null>(null);
  const finish = (reference: string, failure: string | null) => {
    stream.current = null;
    setState(null);
    invalidate();
    onFinished({ reference, failure });
    const title = failure === null ? `Pulled ${reference}` : `Couldn't pull ${reference}`;
    notifyWhenAway(title, failure).catch(() => undefined);
  };
  const onEvent = (reference: string, event: PullEvent) => {
    if (event.kind === "progress") {
      setState((current) => ({
        reference,
        layers: applyPullProgress(current?.layers ?? [], event.progress),
      }));
    } else {
      finish(reference, event.kind === "failed" ? event.message : null);
    }
  };
  const start = (reference: string) => {
    setState({ reference, layers: [] });
    commands
      .imagePull(reference, new Channel<PullEvent>((event) => onEvent(reference, event)))
      .then((id) => {
        stream.current = id;
      })
      .catch((error: unknown) => finish(reference, errorMessage(error)));
  };
  const cancel = () => {
    if (stream.current !== null) {
      commands.streamCancel(stream.current).catch(() => undefined);
      stream.current = null;
    }
    setState(null);
  };
  return { state, start, cancel };
}
