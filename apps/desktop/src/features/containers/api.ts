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
