import {
  IconBraces,
  IconChevronDown,
  IconChevronUp,
  IconLayoutSidebarRight,
  IconSql,
  IconX,
} from "@tabler/icons-react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import clsx from "clsx";
import { toast } from "sonner";

import type { Column } from "@/lib/ipc/bindings";
import { Button } from "@/ui/button";
import { Chip } from "@/ui/chip";
import { IconAction } from "@/ui/icon-action";

import { cellText } from "../model";
import { CellValue } from "./cell-value";
import { asInserts, type GridRow } from "./grid-model";

type InspectorProps = {
  table: string;
  columns: Column[];
  row: GridRow | undefined;
  onStep: (direction: 1 | -1) => void;
  onClose: () => void;
};

function copy(label: string, text: string) {
  writeText(text)
    .then(() => toast(`Copied ${label}`))
    .catch(() => undefined);
}

/** Every field of the selected row, with long text and JSON shown in full. */
export function RowInspector({ table, columns, row, onStep, onClose }: InspectorProps) {
  if (!row) {
    return (
      <aside
        aria-label="Row inspector"
        className="flex flex-col items-center justify-center gap-1.5 border-l-[0.5px] border-line bg-panel-solid p-6 text-center text-ink-3"
      >
        <IconLayoutSidebarRight className="size-5" aria-hidden />
        <p className="m-0">Select a cell to see every field of its row.</p>
      </aside>
    );
  }
  return (
    <aside
      aria-label="Row inspector"
      className="flex min-h-0 flex-col border-l-[0.5px] border-line bg-panel-solid"
    >
      <div className="flex h-10 shrink-0 items-center gap-2 border-b-[0.5px] border-line pr-1.5 pl-3.5">
        <b className="font-semibold text-ink">{table}</b>
        <span className="ml-auto flex">
          <IconAction label="Previous row" onClick={() => onStep(-1)}>
            <IconChevronUp />
          </IconAction>
          <IconAction label="Next row" onClick={() => onStep(1)}>
            <IconChevronDown />
          </IconAction>
          <IconAction label="Close inspector" onClick={onClose}>
            <IconX />
          </IconAction>
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto pt-1 pb-3">
        {columns.map((column, index) => {
          const value = row.values[index] ?? null;
          const text = cellText(value) ?? "";
          const edited = column.name in row.edited;
          return (
            <div
              key={column.name}
              className={clsx(
                "border-b-[0.5px] border-line px-3.5 py-2",
                edited && "shadow-[inset_2px_0_0_var(--warn)]",
              )}
            >
              <div className="mb-1 flex items-center gap-1.5 text-12">
                <span className="font-medium text-ink">{column.name}</span>
                {edited ? <Chip tone="brand">Edited</Chip> : null}
                <span className="ml-auto font-mono text-mono-12 text-ink-3">{column.typeName}</span>
              </div>
              {typeof value === "object" && value !== null ? (
                <pre className="m-0 max-h-56 overflow-auto rounded-sm bg-fill px-2.5 py-2 font-mono text-mono-12 whitespace-pre-wrap text-ink select-text">
                  {JSON.stringify(value, null, 2)}
                </pre>
              ) : (
                <div
                  className={clsx(
                    "font-mono text-mono-13 leading-normal [overflow-wrap:anywhere] text-ink select-text",
                    text.length > 120 && "max-h-56 overflow-auto rounded-sm bg-fill px-2.5 py-2",
                  )}
                >
                  <CellValue value={value} />
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="flex shrink-0 gap-1.5 border-t-[0.5px] border-line px-3.5 py-2.5">
        <Button
          size="sm"
          onClick={() =>
            copy(
              "as JSON",
              JSON.stringify(
                Object.fromEntries(
                  columns.map((column, index) => [column.name, row.values[index] ?? null]),
                ),
                null,
                2,
              ),
            )
          }
        >
          <IconBraces />
          Copy as JSON
        </Button>
        <Button size="sm" onClick={() => copy("as insert", asInserts(table, columns, [row]))}>
          <IconSql />
          Copy as insert
        </Button>
      </div>
    </aside>
  );
}
