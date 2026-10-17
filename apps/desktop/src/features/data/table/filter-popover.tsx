import { Popover } from "radix-ui";
import { type ReactElement, useId, useState } from "react";

import type { Column, Filter, FilterOp } from "@/lib/ipc/bindings";
import { Button } from "@/ui/button";
import { inputClass } from "@/ui/input-class";

import { FILTER_OPS } from "../model";

type FilterPopoverProps = {
  columns: Column[];
  /** Edits this filter; without it the popover adds one. */
  filter?: Filter;
  onApply: (filter: Filter) => void;
  children: ReactElement;
};

/** Column, operator and value, applied in the database when saved. */
export function FilterPopover({ columns, filter, onApply, children }: FilterPopoverProps) {
  const [open, setOpen] = useState(false);
  const [column, setColumn] = useState(filter?.column ?? columns[0]?.name ?? "");
  const [op, setOp] = useState<FilterOp>(filter?.op ?? "equals");
  const [value, setValue] = useState(filter?.value ?? "");
  const ids = { column: useId(), op: useId(), value: useId() };
  const needsValue = FILTER_OPS.find((entry) => entry.op === op)?.needsValue ?? true;
  const apply = (event: React.FormEvent) => {
    event.preventDefault();
    onApply({ column, op, value: needsValue ? value : null });
    setOpen(false);
  };
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>{children}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          className="z-50 w-[440px] rounded-[10px] bg-[light-dark(oklch(0.99_0_0/0.92),oklch(0.27_0.005_255/0.94))] p-2.5 shadow-3 backdrop-blur-xl animate-pop"
        >
          <form onSubmit={apply} className="flex flex-col gap-2.5">
            <p className="m-0 text-12 font-medium text-ink-3">
              {filter ? "Edit filter" : "Add a filter"}
            </p>
            <div className="grid grid-cols-[150px_120px_1fr] gap-1.5">
              <label htmlFor={ids.column} className="sr-only">
                Column
              </label>
              <select
                id={ids.column}
                className={inputClass}
                value={column}
                onChange={(event) => setColumn(event.target.value)}
              >
                {columns.map((candidate) => (
                  <option key={candidate.name} value={candidate.name}>
                    {candidate.name}
                  </option>
                ))}
              </select>
              <label htmlFor={ids.op} className="sr-only">
                Condition
              </label>
              <select
                id={ids.op}
                className={inputClass}
                value={op}
                onChange={(event) => setOp(event.target.value as FilterOp)}
              >
                {FILTER_OPS.map((entry) => (
                  <option key={entry.op} value={entry.op}>
                    {entry.label}
                  </option>
                ))}
              </select>
              <label htmlFor={ids.value} className="sr-only">
                Value
              </label>
              <input
                id={ids.value}
                className={`${inputClass} font-mono text-mono-13`}
                value={value}
                disabled={!needsValue}
                onChange={(event) => setValue(event.target.value)}
                placeholder={needsValue ? "Value" : ""}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button size="sm" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button size="sm" variant="brand" type="submit">
                Apply
              </Button>
            </div>
          </form>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
