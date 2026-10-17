import { useState } from "react";

import { formatMemory, formatPercent } from "@/lib/format";
import type { MetricsPoint } from "@/lib/ipc/bindings";
import { Chart } from "@/ui/chart";
import { Segmented } from "@/ui/segmented";

import { memorySeries, type Range, withinRange } from "./model";

const RANGES: { value: Range; label: string }[] = [
  { value: "5m", label: "Last 5 min" },
  { value: "30m", label: "30 min" },
];

type ChartsProps = { points: MetricsPoint[]; cpus: number; totalBytes: number };

/** CPU and memory over the last few minutes, memory split by project. */
export function EngineCharts({ points, cpus, totalBytes }: ChartsProps) {
  const [range, setRange] = useState<Range>("5m");
  const shown = withinRange(points, range, points.at(-1)?.sampledAtMs ?? 0);
  const times = shown.map((point) => (point.sampledAtMs ?? 0) / 1000);
  const memory = memorySeries(shown);
  const latest = shown.at(-1);
  return (
    <section className="px-5 pt-5 pb-1">
      <div className="mb-3.5 flex items-center gap-3">
        <h2 className="m-0 text-14 font-semibold text-ink">Engine</h2>
        <span className="ml-auto">
          <Segmented
            label="Time range"
            size="sm"
            value={range}
            onChange={setRange}
            options={RANGES}
          />
        </span>
      </div>
      <div className="grid grid-cols-2 gap-x-8 gap-y-6 max-[1180px]:grid-cols-1">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-12 font-medium text-ink-3">CPU</span>
          <span className="flex items-baseline gap-1.5">
            <b className="text-20 font-semibold tracking-[-0.01em] text-ink tabular">
              {formatPercent(latest?.cpuPercent ?? null)}
            </b>
            <span className="text-12 text-ink-3">
              of {cpus * 100}% across {cpus} cores
            </span>
          </span>
          <Chart
            label="Engine CPU over time"
            height={120}
            series={[{ label: "CPU", color: "var(--s1)" }]}
            data={[times, shown.map((point) => point.cpuPercent)]}
            format={(value) => `${Math.round(value)}%`}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-12 font-medium text-ink-3">Memory</span>
          <span className="flex items-baseline gap-1.5">
            <b className="text-20 font-semibold tracking-[-0.01em] text-ink tabular">
              {formatMemory(latest?.usedBytes ?? 0)}
            </b>
            <span className="text-12 text-ink-3">of {formatMemory(totalBytes)}</span>
          </span>
          <Chart
            label="Engine memory over time by project"
            height={120}
            series={memory.map(({ label, color }) => ({ label, color, fill: false }))}
            data={[times, ...memory.map((line) => line.values)]}
            format={formatMemory}
            binary
          />
        </div>
      </div>
    </section>
  );
}
