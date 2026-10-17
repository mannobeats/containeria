import { useQuery, useQueryClient } from "@tanstack/react-query";

import { commands, events, type MetricsPoint } from "@/lib/ipc/bindings";
import { useTauriEvent } from "@/lib/ipc/use-tauri-event";

import { appendPoint } from "./model";

const key = ["metrics-history"] as const;

/** Thirty minutes at one sample every two seconds, as the Rust sampler keeps. */
const LIMIT = 900;

/** The sampler's history, then each new sample appended as it arrives. */
export function useMetricsHistory() {
  const client = useQueryClient();
  useTauriEvent(events.metricsUpdated, (metrics) => {
    const point: MetricsPoint = {
      sampledAtMs: metrics.sampledAtMs,
      cpuPercent: metrics.containers.reduce((total, usage) => total + (usage.cpuPercent ?? 0), 0),
      usedBytes: metrics.ledger.usedBytes,
      segments: metrics.ledger.segments,
    };
    client.setQueryData<MetricsPoint[]>(key, (points) => appendPoint(points ?? [], point, LIMIT));
  });
  return useQuery({
    queryKey: key,
    queryFn: commands.metricsHistory,
    staleTime: Number.POSITIVE_INFINITY,
  });
}
