import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Channel } from "@tauri-apps/api/core";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { queryKeys } from "@/app/query-keys";
import { useRemoveMany } from "@/app/use-remove-many";
import { isServing, useEngineStatus } from "@/features/engine/api";
import { notifyWhenAway } from "@/features/settings/api";
import { announceCleanUp } from "@/features/storage/api";
import { commands, type ImageSummary, type PullEvent } from "@/lib/ipc/bindings";
import { errorMessage } from "@/lib/ipc/errors";

import { applyPullProgress, imageLabel, type PullLayer } from "./model";

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

/** Trivy's findings for `reference`; the first scan downloads Trivy, so a result is kept a while. */
export function useImageScan(reference: string | null) {
  return useQuery({
    queryKey: [...queryKeys.images, "scan", reference],
    queryFn: () => commands.imageScan(reference ?? ""),
    enabled: reference !== null,
    retry: false,
    staleTime: 10 * 60_000,
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

/** Deletes the picked images; one with several tags loses them all. */
export function useRemoveImages() {
  return useRemoveMany({
    remove: (image: ImageSummary) => commands.imageRemove(image.id, image.references.length > 1),
    name: imageLabel,
    noun: "image",
    invalidates: queryKeys.images,
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
      announceCleanUp(
        report,
        `${report.removed} ${report.removed === 1 ? "image" : "images"} deleted`,
      ),
    onError: (error) => toast.error("Clean-up failed", { description: errorMessage(error) }),
    onSettled: invalidate,
  });
}

type PullState = { reference: string; layers: PullLayer[] } | null;

export type PullOutcome = { reference: string; failure: string | null };

/** A started pull; `id` is its stream once `imagePull` has answered. */
type ActivePull = { id: number | null };

/**
 * Starts a pull and tracks its layers; `cancel` stops it, even before its stream id arrives, and
 * drops whatever it still sends. `onFinished` hears how it ended.
 */
export function usePull(onFinished: (outcome: PullOutcome) => void) {
  const invalidate = useInvalidateImages();
  const [state, setState] = useState<PullState>(null);
  const active = useRef<ActivePull | null>(null);
  const finish = (reference: string, failure: string | null) => {
    active.current = null;
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
    const pull: ActivePull = { id: null };
    active.current = pull;
    setState({ reference, layers: [] });
    const channel = new Channel<PullEvent>((event) => {
      if (active.current === pull) {
        onEvent(reference, event);
      }
    });
    commands
      .imagePull(reference, channel)
      .then((id) => {
        pull.id = id;
        if (active.current !== pull) {
          commands.streamCancel(id).catch(() => undefined);
        }
      })
      .catch((error: unknown) => {
        if (active.current === pull) {
          finish(reference, errorMessage(error));
        }
      });
  };
  const cancel = () => {
    const id = active.current?.id ?? null;
    active.current = null;
    if (id !== null) {
      commands.streamCancel(id).catch(() => undefined);
    }
    setState(null);
  };
  return { state, start, cancel };
}
