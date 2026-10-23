import type { ReactNode } from "react";
import type uPlot from "uplot";

import { formatBytes, formatMemory, formatPercent } from "@/lib/format";
import { Chart, type ChartSeries } from "@/ui/chart";
import { EmptyState } from "@/ui/empty-state";
import { Tile } from "@/ui/tile";

import { useStatsHistory } from "./api";

const rate = (bytes: number) => `${formatBytes(bytes)}/s`;
/** Byte rates never tick below whole bytes: an idle container's axis reads up to 1 KB/s. */
const KIB = 1024;

type PanelProps = {
  title: string;
  note: string;
  value?: ReactNode;
  series: ChartSeries[];
  data: uPlot.AlignedData;
  format: (value: number) => string;
  floor?: number;
  binary?: boolean;
};

function Panel({
  title,
  note,
  value,
  series,
  data,
  format,
  floor = 1,
  binary = false,
}: PanelProps) {
  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <h2 className="m-0 text-13 font-semibold text-ink">{title}</h2>
        <span className="text-12 text-ink-3">{note}</span>
        {value ? <b className="ml-auto font-semibold text-ink tabular">{value}</b> : null}
      </div>
      <Chart
        label={`${title}, ${note}`}
        height={170}
        series={series}
        data={data}
        format={format}
        floor={floor}
        binary={binary}
      />
    </section>
  );
}

/** Four live charts, one reading a second, the last five minutes. */
export function StatsTab({ id, running }: { id: string; running: boolean }) {
  const history = useStatsHistory(id, running);
  if (!running) {
    return (
      <EmptyState
        art={<Tile icon="activity" size="xl" />}
        title="No live stats while it's stopped"
        className="h-full"
      >
        Start the container to see CPU, memory, network and disk as they happen.
      </EmptyState>
    );
  }
  const sample = history.last?.sample;
  const limit =
    sample && sample.memoryLimitBytes > 0
      ? `of ${formatMemory(sample.memoryLimitBytes)}`
      : "no limit";
  return (
    <div className="h-full overflow-auto">
      <p className="m-0 px-5 pt-4 text-12 text-ink-3">
        {history.times.length < 2
          ? "Collecting the first readings…"
          : "Sampled every second. The charts keep the last five minutes."}
      </p>
      <div className="grid grid-cols-2 gap-x-8 gap-y-7 px-5 pt-4 pb-10 max-[1180px]:grid-cols-1">
        <Panel
          title="CPU"
          note="of one core per 100%"
          value={formatPercent(sample?.cpuPercent ?? null)}
          series={[{ label: "CPU", color: "var(--s1)" }]}
          data={[history.times, history.cpu]}
          format={formatPercent}
        />
        <Panel
          title="Memory"
          note={limit}
          value={sample ? formatMemory(sample.memoryBytes) : undefined}
          series={[{ label: "Memory", color: "var(--s2)" }]}
          data={[history.times, history.memory]}
          format={formatMemory}
          binary
        />
        <Panel
          title="Network"
          note="received and sent"
          series={[
            { label: "Received", color: "var(--s1)" },
            { label: "Sent", color: "var(--s3)", fill: false },
          ]}
          data={[history.times, history.received, history.sent]}
          format={rate}
          floor={KIB}
        />
        <Panel
          title="Disk"
          note="read and written"
          series={[
            { label: "Read", color: "var(--s4)" },
            { label: "Written", color: "var(--s6)", fill: false },
          ]}
          data={[history.times, history.read, history.written]}
          format={rate}
          floor={KIB}
        />
      </div>
    </div>
  );
}
