import { segmentColor } from "@/features/metrics/segment-color";
import type { ContainerSummary, Metrics, MetricsPoint } from "@/lib/ipc/bindings";
/** One line of a chart: a label, a CSS colour and a value per sample (`null` for a gap). */
export type TimeSeries = { label: string; color: string; values: (number | null)[] };

export type Range = "5m" | "30m";

const MINUTES: Record<Range, number> = { "5m": 5, "30m": 30 };

/** Points sampled within the last `range`, oldest first. */
export function withinRange(points: MetricsPoint[], range: Range, now: number): MetricsPoint[] {
  const since = now - MINUTES[range] * 60_000;
  return points.filter((point) => (point.sampledAtMs ?? 0) >= since);
}

/** Adds a pushed sample to the history unless it's already there, keeping the newest `limit`. */
export function appendPoint(
  points: MetricsPoint[],
  point: MetricsPoint,
  limit: number,
): MetricsPoint[] {
  if (points.at(-1)?.sampledAtMs === point.sampledAtMs) {
    return points;
  }
  return [...points, point].slice(-limit);
}

/** One memory line per project seen in the window, plus the total. */
export function memorySeries(points: MetricsPoint[]): TimeSeries[] {
  const segments = new Map<string, { label: string; color: string }>();
  for (const point of points) {
    for (const segment of point.segments) {
      segments.set(segment.id, { label: segment.label, color: segmentColor(segment) });
    }
  }
  const lines = [...segments].map(([id, { label, color }]) => ({
    label,
    color,
    values: points.map((point) => point.segments.find((segment) => segment.id === id)?.bytes ?? 0),
  }));
  return [
    { label: "Total", color: "var(--ink-3)", values: points.map((point) => point.usedBytes) },
    ...lines,
  ];
}

export type Consumer = {
  id: string;
  name: string;
  /** `namespace/name` when the container runs a Kubernetes pod. */
  pod: string | null;
  image: string;
  group: string;
  cpuPercent: number | null;
  memoryBytes: number;
};

/** The pause container Kubernetes keeps beside every pod: plumbing, not a workload. */
const isPodSandbox = (container: ContainerSummary) =>
  container.pod !== null && container.name.startsWith("k8s_POD_");

/** Running containers by memory, biggest first. A pod's container goes by its pod's name. */
export function topConsumers(
  metrics: Metrics | null | undefined,
  containers: ContainerSummary[],
  limit = 10,
): Consumer[] {
  const byId = new Map(containers.map((container) => [container.id, container]));
  return (metrics?.containers ?? [])
    .flatMap((usage) => {
      const container = byId.get(usage.id);
      if (!container || isPodSandbox(container)) {
        return [];
      }
      const group = container.pod ? "Kubernetes" : (container.project ?? "Standalone");
      return [
        {
          id: usage.id,
          name: container.pod?.split("/").at(-1) ?? container.name,
          pod: container.pod,
          image: container.image,
          group,
          cpuPercent: usage.cpuPercent,
          memoryBytes: usage.memoryBytes,
        },
      ];
    })
    .toSorted((a, b) => b.memoryBytes - a.memoryBytes)
    .slice(0, limit);
}
