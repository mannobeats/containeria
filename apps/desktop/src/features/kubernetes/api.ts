import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Channel } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { useState } from "react";
import { toast } from "sonner";

import { queryKeys } from "@/app/query-keys";
import { isServing, useBootLog, useEngineStatus } from "@/features/engine/api";
import {
  type ConfigSummary,
  commands,
  type DeploymentSummary,
  type LogLine,
  type PodSummary,
  type ResourceKind,
} from "@/lib/ipc/bindings";
import type { OpenShell } from "@/lib/ipc/connect-shell";
import { errorMessage } from "@/lib/ipc/errors";
import { useStream } from "@/lib/ipc/use-stream";

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
function useKubeAction<Args, Output>(
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

/**
 * Reads the deployment's YAML from the cluster, never from cache, so an edit can't put back what a
 * newer scale or apply changed.
 */
export function editYaml(deployment: DeploymentSummary, onManifest: (manifest: string) => void) {
  commands
    .kubernetesYaml("deployment", deployment.namespace, deployment.name)
    .then(onManifest)
    .catch((error: unknown) =>
      toast.error("The YAML couldn't be read", { description: errorMessage(error) }),
    );
}

export function useKubeEvents(namespace: string, name: string) {
  return useQuery({
    queryKey: [...queryKeys.kubernetes, "events", namespace, name],
    queryFn: () => commands.kubernetesEvents(namespace, name),
  });
}

/** Where the cluster's kubeconfig is, for other tools. It only moves if `$KUBECONFIG` does. */
export function useKubeconfigPath() {
  return useQuery({
    queryKey: [...queryKeys.kubernetes, "kubeconfig"],
    queryFn: commands.kubernetesKubeconfigPath,
    staleTime: Number.POSITIVE_INFINITY,
  });
}

export function useCreateNamespace() {
  return useKubeAction(
    (name: string) => commands.kubernetesCreateNamespace(name),
    (name) => `Created namespace ${name}`,
  );
}

type Target = { namespace: string; name: string };

export function useDeletePod() {
  return useKubeAction(
    ({ namespace, name }: Target) => commands.kubernetesDeletePod(namespace, name),
    ({ name }) => `Deleted ${name}`,
  );
}

export function useDeleteDeployment() {
  return useKubeAction(
    ({ namespace, name }: Target) => commands.kubernetesDeleteDeployment(namespace, name),
    ({ name }) => `Deleted ${name}`,
  );
}

export function useRestartDeployment() {
  return useKubeAction(
    ({ namespace, name }: Target) => commands.kubernetesRestartDeployment(namespace, name),
    ({ name }) => `Restarting ${name}`,
  );
}

export function useScaleDeployment(deployment: DeploymentSummary) {
  return useKubeAction(
    (count: number) =>
      commands.kubernetesScaleDeployment(deployment.namespace, deployment.name, count),
    (count) => `${deployment.name} scaled to ${count}`,
  );
}

type Apply = { manifest: string; namespace: string; dryRun: boolean };

export function useApply() {
  return useKubeAction(
    ({ manifest, namespace, dryRun }: Apply) =>
      commands.kubernetesApply(manifest, namespace, dryRun),
    ({ dryRun }) => (dryRun ? "The manifest is valid" : "Applied"),
  );
}

/** One key of a config map or secret, read only while `shown` or when copied. */
export function useConfigValue(config: ConfigSummary, key: string, shown: boolean) {
  const client = useQueryClient();
  const options = {
    queryKey: [...queryKeys.kubernetes, "value", config.kind, config.namespace, config.name, key],
    queryFn: () => commands.kubernetesConfigValue(config.kind, config.namespace, config.name, key),
    staleTime: Number.POSITIVE_INFINITY,
  };
  const value = useQuery({ ...options, enabled: shown });
  const copy = () =>
    client.fetchQuery(options).then(
      (text) =>
        writeText(text).then(
          () => toast("Copied", { description: key }),
          (error: unknown) =>
            toast.error(`${key} wasn't copied`, { description: errorMessage(error) }),
        ),
      (error: unknown) =>
        toast.error("The value couldn't be read", { description: errorMessage(error) }),
    );
  return { value, copy };
}

/** Older lines drop off past this, so a chatty pod can't grow the view without bound. */
const KEEP = 5000;

/** The pod's log, followed live; `container` picks one when it has several. */
export function usePodLog(pod: PodSummary, container: string | null) {
  const [lines, setLines] = useState<string[]>([]);
  useStream<string>(
    `${pod.namespace}/${pod.name}/${container ?? ""}`,
    (channel) => {
      setLines([]);
      return commands.kubernetesLogs(pod.namespace, pod.name, container, channel);
    },
    (line) => setLines((current) => [...current.slice(-(KEEP - 1)), line]),
  );
  return lines;
}

/** A shell in the pod; `container` picks one when it has several. */
export const podShell =
  (pod: PodSummary, container: string | null): OpenShell =>
  (cols, rows, channel) =>
    commands.kubernetesShell(pod.namespace, pod.name, container, cols, rows, channel);
