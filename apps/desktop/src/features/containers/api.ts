import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { queryKeys } from "@/app/query-keys";
import { isServing, useEngineStatus } from "@/features/engine/api";
import { type ContainerAction, type ContainerSummary, commands } from "@/lib/ipc/bindings";
import { errorMessage } from "@/lib/ipc/errors";

export function useContainers() {
  const { data: engine } = useEngineStatus();
  return useQuery({
    queryKey: queryKeys.containers,
    queryFn: commands.containersList,
    enabled: isServing(engine?.phase),
    // Events refresh it on every change; this only keeps Docker's "Up 3 minutes" text current.
    refetchInterval: 30_000,
  });
}

const past: Record<ContainerAction, string> = {
  start: "Started",
  stop: "Stopped",
  restart: "Restarted",
  pause: "Paused",
  resume: "Resumed",
  kill: "Killed",
  remove: "Deleted",
};

const UNDO: Partial<Record<ContainerAction, ContainerAction>> = { stop: "start", pause: "resume" };

type Act = {
  containers: Pick<ContainerSummary, "id" | "name">[];
  action: ContainerAction;
  label?: string;
};

type Recreate = { id: string; name: string; pull: boolean };

/**
 * Creates a container again from its own settings, so changed engine settings or, with `pull`,
 * a newer image take effect. Resolves to the new container's ID.
 */
export function useRecreate() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, pull }: Recreate) => commands.containerRecreate(id, pull),
    onMutate: ({ name }) => toast.loading(`Recreating ${name}…`),
    onSuccess: (_, { name }, loading) =>
      toast.success(`Recreated ${name}`, loading === undefined ? {} : { id: loading }),
    onError: (error, _, loading) =>
      toast.error("Couldn't recreate the container", {
        description: errorMessage(error),
        ...(loading === undefined ? {} : { id: loading }),
      }),
    onSettled: () => client.invalidateQueries({ queryKey: queryKeys.containers }),
  });
}

/** Runs one action on one or more containers and says what happened. */
export function useContainerAction() {
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: async ({ containers, action }: Act) => {
      const results = await Promise.allSettled(
        containers.map(({ id }) => commands.containerAct(id, action)),
      );
      const failed = results.flatMap((result) =>
        result.status === "rejected" ? [result.reason] : [],
      );
      if (failed.length > 0) {
        throw failed[0];
      }
    },
    onSuccess: (_, { containers, action, label }) => {
      const what =
        label ??
        (containers.length === 1 ? containers[0]?.name : `${containers.length} containers`);
      const undo = UNDO[action];
      toast.success(`${past[action]} ${what}`, {
        ...(undo
          ? {
              action: {
                label: "Undo",
                onClick: () => mutation.mutate({ containers, action: undo }),
              },
            }
          : {}),
      });
    },
    onError: (error, { action }) =>
      toast.error(`Couldn't ${action} the container`, { description: errorMessage(error) }),
    onSettled: () => client.invalidateQueries({ queryKey: queryKeys.containers }),
  });
  return mutation;
}
