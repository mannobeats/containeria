import clsx from "clsx";
import type { ComponentProps, ReactNode } from "react";

import type { Selection } from "@/lib/use-selection";

import { Checkbox } from "./checkbox";
import { openRowOnClick } from "./row-click";
import { Tip } from "./tooltip";

/** A full-width list table: hairline rows, sticky header, 20px outer padding. */
export function Table({ label, children }: { label: string; children: ReactNode }) {
  return (
    <table
      ref={openRowOnClick}
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

/** Other props reach the `<tr>`, so a `ContextMenu` around the row can open on right-click. */
type RowProps = ComponentProps<"tr"> & { dim?: boolean; selected?: boolean };

/** A hoverable row. Give its first cell a `rowLink` link with `data-row-link` to open on click. */
export function Row({ dim = false, selected = false, className, children, ...props }: RowProps) {
  return (
    <tr
      {...props}
      aria-selected={selected || undefined}
      className={clsx(
        "group/row h-9 transition-colors duration-140 hover:bg-hover data-[state=open]:bg-hover [&>td]:border-b-[0.5px] [&>td]:border-line [&>td]:px-2.5 [&>td]:whitespace-nowrap",
        dim && "[&>td]:text-ink-3",
        selected && "bg-select hover:bg-select",
        className,
      )}
    >
      {children}
    </tr>
  );
}

/** Row actions: hidden until the row is hovered or focused. */
export function RowActions({ children }: { children: ReactNode }) {
  return (
    <td className="text-right">
      <span className="inline-flex gap-0.5 opacity-0 transition-opacity duration-140 group-focus-within/row:opacity-100 group-hover/row:opacity-100">
        {children}
      </span>
    </td>
  );
}

/** The header's box: selects every row that can be selected, or none. */
export function SelectAll({ selection, label }: { selection: Selection; label: string }) {
  return (
    <th className="w-11">
      <Checkbox checked={selection.all} onCheckedChange={selection.setAll} label={label} />
    </th>
  );
}

type SelectCellProps = {
  selection: Selection;
  id: string;
  label: string;
  /** Why the row can't be selected, such as "In use by web-1"; the box is greyed out. */
  blocked?: string | undefined;
};

/** A row's box, for acting on many rows at once. */
export function SelectCell({ selection, id, label, blocked }: SelectCellProps) {
  if (blocked) {
    return (
      <td className="w-11">
        <Tip label={blocked}>
          <span className="inline-flex">
            <Checkbox checked={false} onCheckedChange={() => undefined} label={label} disabled />
          </span>
        </Tip>
      </td>
    );
  }
  return (
    <td className="w-11">
      <Checkbox
        checked={selection.has(id)}
        onCheckedChange={() => selection.toggle(id)}
        label={label}
      />
    </td>
  );
}
