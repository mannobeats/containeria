import { IconPlayerPlay } from "@tabler/icons-react";

import { MemoryLedger } from "@/features/metrics/memory-ledger";
import { segmentColor } from "@/features/metrics/segment-color";
import { formatMemory } from "@/lib/format";
import type { ContainerSummary, Ledger } from "@/lib/ipc/bindings";
import { Button } from "@/ui/button";
import { Kbd } from "@/ui/kbd";
import { Skeleton } from "@/ui/progress";

import { isRunning } from "./model";
import { useRunSheet } from "./run/api";

function Answer({
  containers,
  ledger,
}: {
  containers: ContainerSummary[];
  ledger: Ledger | undefined;
}) {
  const top = ledger?.segments.toSorted((a, b) => b.bytes - a.bytes)[0];
  return (
    <p className="m-0 mb-3.5 max-w-[78ch] text-14 text-pretty text-ink-2 [&_b]:font-semibold [&_b]:text-ink">
      <b>
        {containers.filter(isRunning).length} of {containers.length}
      </b>{" "}
      containers running
      {ledger ? (
        <>
          , using <b className="tabular">{formatMemory(ledger.usedBytes)}</b> of the engine's{" "}
          {formatMemory(ledger.totalBytes)}.
          {top && top.bytes > 0 ? (
            <>
              {" "}
              <b>{top.label}</b> uses the most.
            </>
          ) : null}
        </>
      ) : (
        "."
      )}
    </p>
  );
}

function Legend({
  ledger,
  onHot,
}: {
  ledger: Ledger | undefined;
  onHot: (id: string | null) => void;
}) {
  return (
    <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1">
      {ledger?.segments
        .filter((segment) => segment.bytes > 0)
        .map((segment) => (
          <button
            key={segment.id}
            type="button"
            onMouseEnter={() => onHot(segment.id)}
            onMouseLeave={() => onHot(null)}
            onFocus={() => onHot(segment.id)}
            onBlur={() => onHot(null)}
            className="-mx-1.5 inline-flex h-[22px] items-center gap-1.5 rounded-[5px] px-1.5 text-12 text-ink-2 transition-colors duration-140 hover:bg-hover"
          >
            <span
              aria-hidden
              className="size-2.5 rounded-[3px]"
              style={{ background: segmentColor(segment) }}
            />
            {segment.label}
            <span className="ml-0.5 text-ink-3 tabular">{formatMemory(segment.bytes)}</span>
          </button>
        ))}
    </div>
  );
}

type HeroProps = {
  containers: ContainerSummary[] | undefined;
  ledger: Ledger | undefined;
  hot: string | null;
  onHot: (id: string | null) => void;
};

/** The answer to "what's running and where's my memory going", above the list. */
export function ContainersHero({ containers, ledger, hot, onHot }: HeroProps) {
  const showRunSheet = useRunSheet((state) => state.show);
  return (
    <section className="px-5 pt-[18px] pb-4">
      <div className="mb-2.5 flex items-center">
        <h1 className="m-0 text-20 font-semibold tracking-[-0.012em] text-balance text-ink">
          Containers
        </h1>
        <Button variant="brand" className="ml-auto" onClick={showRunSheet}>
          <IconPlayerPlay />
          Run container
          <Kbd className="bg-white/15 text-inherit shadow-none">⌘N</Kbd>
        </Button>
      </div>
      {containers ? (
        <Answer containers={containers} ledger={ledger} />
      ) : (
        <Skeleton className="mb-3.5 h-4 w-96" />
      )}
      <MemoryLedger ledger={ledger} size="lg" interactive highlight={hot} />
      <Legend ledger={ledger} onHot={onHot} />
    </section>
  );
}
