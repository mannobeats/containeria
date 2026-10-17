import { useState } from "react";

import { MemoryLedger } from "@/features/metrics/memory-ledger";
import { segmentColor } from "@/features/metrics/segment-color";
import { formatMemory } from "@/lib/format";
import type { EngineStatus, Ledger } from "@/lib/ipc/bindings";

function memoryNote(status: EngineStatus | undefined): string {
  if (status?.phase === "external") {
    return "Measured on the Docker engine set in CONTAINERIA_DOCKER_SOCKET.";
  }
  return status?.returnsMemory
    ? "krunkit hands memory nobody uses back to macOS within seconds."
    : "Apple Virtualization keeps memory the engine has used until it restarts.";
}

type HeroProps = { ledger: Ledger | undefined; status: EngineStatus | undefined };

/** How much memory is in use, and by what, in one glance. */
export function ActivityHero({ ledger, status }: HeroProps) {
  const [hot, setHot] = useState<string | null>(null);
  const free = ledger ? Math.max(0, ledger.totalBytes - ledger.usedBytes) : 0;
  return (
    <section className="border-b-[0.5px] border-line px-5 pt-6 pb-5">
      <div className="mb-4 flex flex-col gap-1">
        <div>
          <span className="text-[36px] leading-[1.1] font-semibold tracking-[-0.025em] text-ink tabular">
            {ledger ? formatMemory(ledger.usedBytes) : "—"}
          </span>
          <span className="ml-2.5 text-16 text-ink-3">
            in use of {ledger ? formatMemory(ledger.totalBytes) : "—"}
          </span>
        </div>
        <p className="m-0 text-14 text-ink-2">{memoryNote(status)}</p>
      </div>
      <MemoryLedger ledger={ledger} size="lg" interactive highlight={hot} />
      <ul className="m-0 mt-3 flex list-none flex-wrap gap-x-5 gap-y-1.5 p-0">
        {ledger?.segments
          .filter((segment) => segment.bytes > 0)
          .map((segment) => (
            <li key={segment.id}>
              <button
                type="button"
                onMouseEnter={() => setHot(segment.id)}
                onMouseLeave={() => setHot(null)}
                onFocus={() => setHot(segment.id)}
                onBlur={() => setHot(null)}
                className="inline-flex items-center gap-[7px] text-13 text-ink-2"
              >
                <i
                  aria-hidden
                  className="size-2.5 rounded-[3px]"
                  style={{ background: segmentColor(segment) }}
                />
                {segment.label}
                <b className="font-medium text-ink tabular">{formatMemory(segment.bytes)}</b>
              </button>
            </li>
          ))}
        <li className="inline-flex items-center gap-[7px] text-13 text-ink-2">
          <i aria-hidden className="size-2.5 rounded-[3px] bg-fill hairline" />
          Free
          <b className="font-medium text-ink tabular">{formatMemory(free)}</b>
        </li>
      </ul>
    </section>
  );
}
