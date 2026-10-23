import clsx from "clsx";

import { formatMemory } from "@/lib/format";
import type { Ledger } from "@/lib/ipc/bindings";
import { Tip } from "@/ui/tooltip";

import { segmentColor } from "./segment-color";

const heights = {
  sm: "h-1.5 gap-[1.5px] rounded-[3px]",
  md: "h-2.5 gap-0.5 rounded-[5px]",
  lg: "h-3.5 gap-0.5 rounded-[7px]",
} as const;

type MemoryLedgerProps = {
  ledger: Ledger | undefined;
  size?: keyof typeof heights;
  interactive?: boolean;
  highlight?: string | null;
};

/** Containeria's signature: the engine's memory, split by what is using it. */
export function MemoryLedger({
  ledger,
  size = "md",
  interactive = false,
  highlight = null,
}: MemoryLedgerProps) {
  const total = Math.max(ledger?.totalBytes ?? 0, ledger?.usedBytes ?? 0, 1);
  const label = ledger
    ? `Engine memory: ${formatMemory(ledger.usedBytes)} used of ${formatMemory(ledger.totalBytes)}`
    : "Engine memory: no reading yet";
  return (
    <div
      role="img"
      aria-label={label}
      className={clsx("relative flex overflow-hidden bg-fill", heights[size])}
    >
      {ledger?.segments
        .filter((segment) => segment.bytes > 0)
        .map((segment) => {
          const bar = (
            <span
              key={segment.id}
              className={clsx(
                "h-full shrink-0 transition-[width,opacity] duration-700 ease-out first:rounded-l-[inherit]",
                highlight !== null && highlight !== segment.id && "opacity-25",
              )}
              style={{
                width: `${(segment.bytes / total) * 100}%`,
                background: segmentColor(segment),
              }}
            />
          );
          return interactive ? (
            <Tip key={segment.id} label={`${segment.label} · ${formatMemory(segment.bytes)}`}>
              {bar}
            </Tip>
          ) : (
            bar
          );
        })}
    </div>
  );
}
