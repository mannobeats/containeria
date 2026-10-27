import { useQuery, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/app/query-keys";
import { commands, events, type Metrics } from "@/lib/ipc/bindings";
import { useTauriEvent } from "@/lib/ipc/use-tauri-event";

/** The latest CPU and memory sample, pushed by the Rust sampler every two seconds. */
export function useMetrics() {
  const client = useQueryClient();
  useTauriEvent(events.metricsUpdated, (metrics) =>
    client.setQueryData<Metrics | null>(queryKeys.metrics, metrics),
  );
  return useQuery({
    queryKey: queryKeys.metrics,
    queryFn: commands.metricsLatest,
    staleTime: Number.POSITIVE_INFINITY,
  });
}

export function usageById(metrics: Metrics | null | undefined) {
  return new Map(metrics?.containers.map((usage) => [usage.id, usage]));
}
