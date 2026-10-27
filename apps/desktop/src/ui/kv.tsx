import clsx from "clsx";
import type { ReactNode } from "react";

export type KvRow = { label: string; value: ReactNode };

/** A two-column list of labelled values, split by hairlines. */
export function Kv({ rows, className }: { rows: KvRow[]; className?: string }) {
  return (
    <dl className={clsx("m-0 grid grid-cols-[140px_minmax(0,1fr)] gap-x-4", className)}>
      {rows.map((row, index) => (
        <div key={row.label} className="contents">
          <dt
            className={clsx(
              "py-[7px] text-13 text-ink-3",
              index > 0 && "border-t-[0.5px] border-line",
            )}
          >
            {row.label}
          </dt>
          <dd
            className={clsx(
              "m-0 flex min-w-0 items-center gap-1.5 py-[7px] text-ink [overflow-wrap:anywhere]",
              index > 0 && "border-t-[0.5px] border-line",
            )}
          >
            {row.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
