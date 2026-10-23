import {
  IconChevronLeft,
  IconChevronRight,
  IconRowInsertBottom,
  IconTable,
  IconTrash,
} from "@tabler/icons-react";
import { useId } from "react";

import type { RowPage } from "@/lib/ipc/bindings";
import { Button } from "@/ui/button";
import { IconAction } from "@/ui/icon-action";
import { inputClass } from "@/ui/input-class";

import type { GridView } from "../workspace-store";

type FooterProps = {
  page: RowPage | undefined;
  view: GridView;
  onView: (change: Partial<GridView>) => void;
  selected: number;
  onDeleteSelected: () => void;
  onAddRow: (() => void) | undefined;
};

const number = (value: number) => value.toLocaleString("en-US");

function totalText(page: RowPage, filtered: boolean): string {
  if (page.total === null) {
    return "";
  }
  const total = `${number(page.total)}${page.totalCapped ? "+" : ""}`;
  return filtered ? ` of ${total} matching rows` : ` of ~${total} rows`;
}

/** Where you are in the table, what's selected, and paging. */
export function GridFooter({
  page,
  view,
  onView,
  selected,
  onDeleteSelected,
  onAddRow,
}: FooterProps) {
  const size = useId();
  const shown = page?.rows.length ?? 0;
  const from = view.page * view.size;
  const more = shown === view.size;
  return (
    <div className="flex h-[38px] shrink-0 items-center gap-3 border-t-[0.5px] border-line bg-panel-solid pr-2 pl-3.5">
      <span className="inline-flex items-center gap-1.5 text-12 text-ink-3 tabular [&_.tabler-icon]:size-3.5">
        <IconTable aria-hidden />
        {shown > 0 ? `${number(from + 1)}–${number(from + shown)}` : "No rows"}
        {page ? totalText(page, view.filters.length > 0) : ""}
        {page?.elapsedMs ? ` · ${Math.round(page.elapsedMs)} ms` : ""}
      </span>
      {selected > 0 ? (
        <span className="inline-flex items-center gap-1.5 text-12 font-medium text-ink">
          {selected} selected
          <Button size="sm" variant="dangerGhost" disabled={!onAddRow} onClick={onDeleteSelected}>
            <IconTrash />
            Delete
          </Button>
        </span>
      ) : null}
      <span className="ml-auto flex items-center gap-1">
        {onAddRow ? (
          <Button variant="ghost" size="sm" onClick={onAddRow}>
            <IconRowInsertBottom />
            Add row
          </Button>
        ) : null}
        <span aria-hidden className="mx-1 h-4 w-[0.5px] bg-line" />
        <label htmlFor={size} className="sr-only">
          Rows per page
        </label>
        <select
          id={size}
          className={`${inputClass} h-6 w-auto text-12`}
          value={view.size}
          onChange={(event) => onView({ size: Number(event.target.value), page: 0 })}
        >
          {[50, 100, 500, 1000].map((option) => (
            <option key={option} value={option}>
              {option} per page
            </option>
          ))}
        </select>
        <IconAction
          label="Previous page"
          disabled={view.page === 0}
          onClick={() => onView({ page: view.page - 1 })}
        >
          <IconChevronLeft />
        </IconAction>
        <span className="text-12 text-ink-3 tabular">{view.page + 1}</span>
        <IconAction
          label="Next page"
          disabled={!more}
          onClick={() => onView({ page: view.page + 1 })}
        >
          <IconChevronRight />
        </IconAction>
      </span>
    </div>
  );
}
