import clsx from "clsx";
import type { ReactNode } from "react";

/** A full-width list table: hairline rows, sticky header, 20px outer padding. */
export function Table({ label, children }: { label: string; children: ReactNode }) {
  return (
    <table
      aria-label={label}
      className="w-full table-fixed border-separate border-spacing-0 text-13 [&_td:first-child]:pl-5 [&_td:last-child]:pr-5 [&_th:first-child]:pl-5 [&_th:last-child]:pr-5"
    >
      {children}
    </table>
  );
}

export function HeadRow({ children }: { children: ReactNode }) {
  return (
    <thead>
      <tr className="[&>th]:sticky [&>th]:top-0 [&>th]:z-[2] [&>th]:h-[30px] [&>th]:border-b-[0.5px] [&>th]:border-line [&>th]:bg-bg [&>th]:px-2.5 [&>th]:text-left [&>th]:text-12 [&>th]:font-medium [&>th]:whitespace-nowrap [&>th]:text-ink-3">
        {children}
      </tr>
    </thead>
  );
}

type RowProps = { dim?: boolean; children: ReactNode };

/**
 * A hoverable row. Make it clickable with a `stretchedLink` link in its first cell; cells holding
 * their own controls take `cellAbove` so they stay clickable.
 */
export function Row({ dim = false, children }: RowProps) {
  return (
    <tr
      className={clsx(
        "group/row relative h-9 transition-colors duration-140 hover:bg-hover [&>td]:border-b-[0.5px] [&>td]:border-line [&>td]:px-2.5 [&>td]:whitespace-nowrap",
        dim && "[&>td]:text-ink-3",
      )}
    >
      {children}
    </tr>
  );
}

/** Row actions: hidden until the row is hovered or focused. */
export function RowActions({ children }: { children: ReactNode }) {
  return (
    <td className="relative z-[1] text-right">
      <span className="inline-flex gap-0.5 opacity-0 transition-opacity duration-140 group-focus-within/row:opacity-100 group-hover/row:opacity-100">
        {children}
      </span>
    </td>
  );
}
