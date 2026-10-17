import { IconKey, IconLink, IconSortAscending, IconSortDescending } from "@tabler/icons-react";
import clsx from "clsx";

import type { Column, Sort } from "@/lib/ipc/bindings";

import { ContextMenu } from "@/ui/menu";

import { headerMenu } from "./grid-menu";
import { nextSort } from "./grid-model";

type HeaderProps = {
  columns: Column[];
  widths: number[];
  sort: Sort | null;
  onSort: ((sort: Sort | null) => void) | undefined;
  onResize: (index: number, width: number) => void;
};

function ariaSort(sorted: Sort | null): "ascending" | "descending" | "none" {
  if (!sorted) {
    return "none";
  }
  return sorted.descending ? "descending" : "ascending";
}

/** Drags a column edge to resize it, tracking the pointer until it lets go. */
function startResize(event: React.PointerEvent, from: number, onWidth: (width: number) => void) {
  event.preventDefault();
  event.stopPropagation();
  const start = event.clientX;
  const move = (moved: PointerEvent) => onWidth(Math.max(60, from + moved.clientX - start));
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

function ColumnHeading({ column, sorted }: { column: Column; sorted: Sort | null }) {
  return (
    <>
      <span
        className={clsx(
          "flex max-w-full items-center gap-1 truncate text-12 font-medium",
          sorted ? "text-brand-ink" : "text-ink",
        )}
      >
        {column.primaryKey ? (
          <IconKey className="size-3 text-warn" aria-label="Primary key" />
        ) : null}
        {column.references ? (
          <IconLink
            className="size-3 text-brand"
            aria-label={`References ${column.references.table}`}
          />
        ) : null}
        {column.name}
      </span>
      <span className="max-w-full truncate font-mono text-[10.5px] text-ink-3">
        {column.typeName}
      </span>
      {sorted ? (
        <span className="absolute top-1/2 right-1.5 -translate-y-1/2 text-brand [&_.tabler-icon]:size-3.5">
          {sorted.descending ? (
            <IconSortDescending aria-hidden />
          ) : (
            <IconSortAscending aria-hidden />
          )}
        </span>
      ) : null}
    </>
  );
}

/** Column names and types; click to sort, drag an edge to resize, right-click for more. */
export function GridHeader({ columns, widths, sort, onSort, onResize }: HeaderProps) {
  return (
    <thead>
      <tr>
        <th className="sticky top-0 left-0 z-[4] h-10 w-[52px] border-r-[0.5px] border-b-[0.5px] border-line-strong bg-panel-solid">
          <span className="sr-only">Row</span>
        </th>
        {columns.map((column, index) => {
          const sorted = sort?.column === column.name ? sort : null;
          return (
            <ContextMenu key={column.name} entries={headerMenu(column, sort, onSort)}>
              <th
                scope="col"
                aria-sort={ariaSort(sorted)}
                className="sticky top-0 z-[3] h-10 border-r-[0.5px] border-b-[0.5px] border-r-line border-b-line-strong bg-bg p-0 text-left font-sans"
              >
                <button
                  type="button"
                  onClick={() => onSort?.(nextSort(sort, column.name))}
                  className={clsx(
                    "relative flex h-10 w-full flex-col justify-center gap-0.5 px-2.5 pr-5 text-left transition-colors duration-140 hover:bg-hover",
                    column.kind === "number" && "items-end",
                  )}
                >
                  <ColumnHeading column={column} sorted={sorted} />
                </button>
                <span
                  aria-hidden
                  onPointerDown={(event) =>
                    startResize(event, widths[index] ?? 120, (width) => onResize(index, width))
                  }
                  className="absolute top-0 -right-[3px] bottom-0 z-[4] w-1.5 cursor-col-resize hover:bg-[linear-gradient(var(--brand),var(--brand))] hover:bg-size-[2px_100%] hover:bg-center hover:bg-no-repeat"
                />
              </th>
            </ContextMenu>
          );
        })}
      </tr>
    </thead>
  );
}
