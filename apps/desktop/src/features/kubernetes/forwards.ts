import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { commands, type PodSummary } from "@/lib/ipc/bindings";
import { errorMessage } from "@/lib/ipc/errors";

/** Its own root, so cluster refetches don't touch it: forwards live in the app, not in Kubernetes. */
const FORWARDS = ["kubernetesForwards"] as const;

/** Port forwards to one pod. Rust owns them, so they survive a reload of the window. */
export function usePodForwards(pod: PodSummary) {
  const { data } = useQuery({ queryKey: FORWARDS, queryFn: commands.kubernetesForwards });
  return (
    data?.filter((forward) => forward.namespace === pod.namespace && forward.pod === pod.name) ?? []
  );
}

export function useStartForward(pod: PodSummary) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ localPort, podPort }: { localPort: number; podPort: number }) =>
      commands.kubernetesPortForward(pod.namespace, pod.name, localPort, podPort),
    onSuccess: (forward) =>
      toast.success(`localhost:${forward.localPort} → ${forward.pod}:${forward.podPort}`),
    onError: (error) =>
      toast.error("The port couldn't be forwarded", { description: errorMessage(error) }),
    onSettled: () => client.invalidateQueries({ queryKey: FORWARDS }),
  });
}

export function useStopForward() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (stream: number) => commands.kubernetesStopForward(stream),
    onError: (error) =>
      toast.error("The forward didn't stop", { description: errorMessage(error) }),
    onSettled: () => client.invalidateQueries({ queryKey: FORWARDS }),
  });
}
