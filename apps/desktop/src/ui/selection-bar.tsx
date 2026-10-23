import { IconX } from "@tabler/icons-react";
import type { ReactNode } from "react";

import { Button } from "./button";

type SelectionBarProps = {
  count: number;
  /** What the bar acts on, for screen readers: "Selected images". */
  label: string;
  onClear: () => void;
  /** The actions, as small ghost buttons. */
  children: ReactNode;
};

/** Floats over a list while rows are selected, with what can be done to all of them. */
export function SelectionBar({ count, label, onClear, children }: SelectionBarProps) {
  return (
    <div
      role="toolbar"
      aria-label={label}
      aria-hidden={count === 0}
      data-on={count > 0 || undefined}
      className="pointer-events-none sticky bottom-4 z-10 mx-auto -mt-14 mb-4 flex w-max translate-y-3 items-center gap-1 rounded-[10px] bg-[light-dark(oklch(0.995_0_0/0.86),oklch(0.28_0.005_255/0.9))] py-[5px] pr-1.5 pl-3.5 opacity-0 shadow-3 backdrop-blur-xl transition-[opacity,transform] duration-220 ease-out data-on:pointer-events-auto data-on:translate-y-0 data-on:opacity-100"
    >
      <b className="mr-1 text-13 font-medium text-ink tabular">{count} selected</b>
      <span aria-hidden className="mx-1 h-4 w-[0.5px] bg-line" />
      {children}
      <Button variant="ghost" size="sm" iconOnly aria-label="Clear selection" onClick={onClear}>
        <IconX />
      </Button>
    </div>
  );
}
