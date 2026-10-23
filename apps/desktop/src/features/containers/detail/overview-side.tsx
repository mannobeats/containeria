import { Link } from "@tanstack/react-router";
import clsx from "clsx";

import { useContainers } from "@/features/containers/api";
import { usageById, useMetrics } from "@/features/metrics/api";
import { formatMemory, formatPercent } from "@/lib/format";
import type { ContainerDetails, Health } from "@/lib/ipc/bindings";
import { logoFor } from "@/lib/logos";
import { Chart } from "@/ui/chart";
import { Tile } from "@/ui/tile";

import { isRunning } from "../model";
import { Section } from "./overview-sections";
import type { StatsHistory } from "./stats-model";

const sideSection = "border-b-[0.5px] border-line pb-5 last:border-b-0";

type SparkProps = {
  title: string;
  value: string;
  times: number[];
  values: number[];
  color: string;
  format: (value: number) => string;
};

function Spark({ title, value, times, values, color, format }: SparkProps) {
  return (
    <div className={sideSection}>
      <Section
        title={title}
        aside={<b className="ml-auto font-semibold text-ink tabular">{value}</b>}
      >
        <Chart
          label={`${title} over the last minutes`}
          spark
          height={64}
          series={[{ label: title, color }]}
          data={[times, values]}
          format={format}
        />
      </Section>
    </div>
  );
}

function HealthStrip({ health }: { health: Health }) {
  const last = health.checks.at(-1);
  return (
    <div className={sideSection}>
      <Section
        title="Health check"
        aside={<span className="ml-auto text-12 text-ink-3 capitalize">{health.status}</span>}
      >
        <div className="grid h-[18px] grid-cols-[repeat(30,1fr)] gap-0.5" aria-hidden>
          {health.checks.slice(-30).map((check) => (
            <i
              key={check.startedAt}
              className={clsx(
                "rounded-[2px]",
                check.exitCode === 0 ? "bg-ok opacity-75" : "bg-bad",
              )}
            />
          ))}
        </div>
        <p className="m-0 mt-1.5 text-12 text-ink-3">
          {health.failingStreak > 0 ? (
            <span className="text-warn-ink">Failing {health.failingStreak} times in a row. </span>
          ) : (
            "Passing. "
          )}
          {last?.output ? <span className="font-mono text-mono-12">{last.output}</span> : null}
        </p>
      </Section>
    </div>
  );
}

function ComposeMates({ details }: { details: ContainerDetails }) {
  const { data: containers } = useContainers();
  const { data: metrics } = useMetrics();
  const usage = usageById(metrics);
  const mates =
    containers?.filter(
      (container) => container.project === details.project && container.id !== details.id,
    ) ?? [];
  if (!details.project || mates.length === 0) {
    return null;
  }
  return (
    <div className={sideSection}>
      <Section
        title={details.project}
        aside={<span className="ml-auto text-12 text-ink-3">{mates.length + 1} services</span>}
      >
        <div className="-mx-1.5 flex flex-col gap-0.5">
          {mates.map((mate) => (
            <Link
              key={mate.id}
              to="/containers/$id"
              params={{ id: mate.id }}
              className="flex h-[30px] items-center gap-2 rounded-sm px-1.5 text-13 text-ink no-underline transition-colors duration-140 hover:bg-hover"
            >
              <Tile logo={logoFor(mate.image)} size="sm" state={isRunning(mate) ? "on" : "off"} />
              <span className="truncate">{mate.service ?? mate.name}</span>
              <span className="ml-auto text-12 text-ink-3 tabular">
                {isRunning(mate) ? formatMemory(usage.get(mate.id)?.memoryBytes ?? 0) : "Stopped"}
              </span>
            </Link>
          ))}
        </div>
      </Section>
    </div>
  );
}

/** Live CPU and memory, health and the rest of the Compose project, beside the details. */
export function OverviewSide({
  details,
  history,
}: {
  details: ContainerDetails;
  history: StatsHistory;
}) {
  const running = details.state === "running";
  const sample = history.last?.sample;
  return (
    <aside className="flex flex-col gap-6 max-[1180px]:grid max-[1180px]:grid-cols-2">
      {running ? (
        <>
          <Spark
            title="CPU"
            value={formatPercent(sample?.cpuPercent ?? null)}
            times={history.times}
            values={history.cpu}
            color="var(--s1)"
            format={formatPercent}
          />
          <Spark
            title="Memory"
            value={sample ? formatMemory(sample.memoryBytes) : "—"}
            times={history.times}
            values={history.memory}
            color="var(--s2)"
            format={formatMemory}
          />
        </>
      ) : null}
      {details.health ? <HealthStrip health={details.health} /> : null}
      <ComposeMates details={details} />
    </aside>
  );
}
