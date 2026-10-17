import clsx from "clsx";

import { Tip } from "./tooltip";

export type UsageSegment = { id: string; label: string; value: number; color?: string };

type UsageBarProps = { segments: UsageSegment[]; label: string; format: (value: number) => string };

/** How a total splits. A segment without a colour is hatched: space nothing needs. */
export function UsageBar({ segments, label, format }: UsageBarProps) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0) || 1;
  return (
    <div
      role="img"
      aria-label={label}
      className="flex h-2.5 gap-0.5 overflow-hidden rounded-[5px] bg-fill"
    >
      {segments
        .filter((segment) => segment.value > 0)
        .map((segment) => (
          <Tip key={segment.id} label={`${segment.label} · ${format(segment.value)}`}>
            <span
              className={clsx(
                "h-full min-w-[3px] shrink-0 transition-opacity duration-140 hover:opacity-80",
                segment.color === undefined &&
                  "bg-[repeating-linear-gradient(-45deg,light-dark(oklch(0.6_0.02_255/0.4),oklch(0.8_0.02_255/0.3))_0_2px,transparent_2px_5px)]",
              )}
              style={{
                width: `${(segment.value / total) * 100}%`,
                ...(segment.color ? { background: segment.color } : {}),
              }}
            />
          </Tip>
        ))}
    </div>
  );
}

/** The key under a `UsageBar`. */
export function UsageLegend({
  segments,
  format,
}: {
  segments: UsageSegment[];
  format: (value: number) => string;
}) {
  return (
    <ul className="m-0 flex list-none flex-wrap items-center gap-x-4 gap-y-1 p-0 text-12 text-ink-3">
      {segments.map((segment) => (
        <li key={segment.id} className="inline-flex items-center gap-1.5 tabular">
          <span
            aria-hidden
            className={clsx(
              "size-2 rounded-[2px]",
              segment.color === undefined &&
                "bg-[repeating-linear-gradient(-45deg,var(--line-strong)_0_1.5px,transparent_1.5px_3px)]",
            )}
            style={segment.color ? { background: segment.color } : undefined}
          />
          {segment.label} {format(segment.value)}
        </li>
      ))}
    </ul>
  );
}
