import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Channel } from "@tauri-apps/api/core";
import { toast } from "sonner";

import { queryKeys } from "@/app/query-keys";
import { isServing, useBootLog, useEngineStatus } from "@/features/engine/api";
import { commands, type LogLine, type ResourceKind } from "@/lib/ipc/bindings";
import { errorMessage } from "@/lib/ipc/errors";

import { crashing } from "./model";

/** Whether Kubernetes is switched on in the engine settings. */
export function useKubernetesEnabled(): boolean | undefined {
  const { data: engine } = useEngineStatus();
  return engine === undefined ? undefined : engine.config.kubernetes.enabled;
}

/** The whole cluster. `KubeChanged` invalidates it (see `app/use-engine-events`); while k3s starts, it retries. */
export function useCluster() {
  const { data: engine } = useEngineStatus();
  return useQuery({
    queryKey: queryKeys.kubernetes,
    queryFn: commands.kubernetesCluster,
    enabled: isServing(engine?.phase) && engine?.config.kubernetes.enabled === true,
    refetchInterval: (query) => (query.state.status === "error" ? 3000 : false),
  });
}

/** Pods that are crash-looping, can't pull their image or otherwise failing. */
export function useFailingPods() {
  return crashing(useCluster().data);
}

/** Runs one cluster action and says what happened. The watcher refreshes the lists. */
export function useKubeAction<Args, Output>(
  run: (args: Args) => Promise<Output>,
  done: (args: Args) => string,
) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: (_, args) => toast.success(done(args)),
    onError: (error) =>
      toast.error("Kubernetes didn't accept that", { description: errorMessage(error) }),
    onSettled: () => client.invalidateQueries({ queryKey: queryKeys.kubernetes }),
  });
}

function useColimaProgress() {
  const push = useBootLog((state) => state.push);
  const clear = useBootLog((state) => state.clear);
  return () => {
    clear();
    return new Channel<LogLine>(push);
  };
}

export function useSetKubernetes() {
  const client = useQueryClient();
  const progress = useColimaProgress();
  return useMutation({
    mutationFn: (enabled: boolean) => commands.kubernetesSetEnabled(enabled, progress()),
    onSuccess: (_, enabled) =>
      toast.success(enabled ? "Kubernetes is running" : "Kubernetes is off"),
    onError: (error) =>
      toast.error("Kubernetes didn't respond", { description: errorMessage(error) }),
    onSettled: () =>
      Promise.all(
        [queryKeys.engine, queryKeys.kubernetes].map((queryKey) =>
          client.invalidateQueries({ queryKey }),
        ),
      ),
  });
}

export function useResetCluster() {
  const progress = useColimaProgress();
  return useKubeAction(
    () => commands.kubernetesReset(progress()),
    () => "Cluster reset",
  );
}

export function useYaml(kind: ResourceKind, namespace: string, name: string) {
  return useQuery({
    queryKey: [...queryKeys.kubernetes, "yaml", kind, namespace, name],
    queryFn: () => commands.kubernetesYaml(kind, namespace, name),
  });
}

export function useKubeEvents(namespace: string, name: string) {
  return useQuery({
    queryKey: [...queryKeys.kubernetes, "events", namespace, name],
    queryFn: () => commands.kubernetesEvents(namespace, name),
  });
}
