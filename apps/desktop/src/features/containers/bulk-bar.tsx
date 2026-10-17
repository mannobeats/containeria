import { IconPlayerPlay, IconPlayerStop, IconRefresh, IconTrash, IconX } from "@tabler/icons-react";

import type { ContainerAction } from "@/lib/ipc/bindings";
import { Button } from "@/ui/button";

type BulkBarProps = {
  count: number;
  onAct: (action: ContainerAction) => void;
  onRemove: () => void;
  onClear: () => void;
};

/** Floats over the list while containers are selected. */
export function BulkBar({ count, onAct, onRemove, onClear }: BulkBarProps) {
  return (
    <div
      role="toolbar"
      aria-label="Selected containers"
      aria-hidden={count === 0}
      data-on={count > 0 || undefined}
      className="pointer-events-none sticky bottom-4 z-10 mx-auto -mt-14 mb-4 flex w-max translate-y-3 items-center gap-1 rounded-[10px] bg-[light-dark(oklch(0.995_0_0/0.86),oklch(0.28_0.005_255/0.9))] py-[5px] pr-1.5 pl-3.5 opacity-0 shadow-3 backdrop-blur-xl transition-[opacity,transform] duration-220 ease-out data-on:pointer-events-auto data-on:translate-y-0 data-on:opacity-100"
    >
      <b className="mr-1 text-13 font-medium text-ink">{count} selected</b>
      <span aria-hidden className="mx-1 h-4 w-[0.5px] bg-line" />
      <Button variant="ghost" size="sm" onClick={() => onAct("start")}>
        <IconPlayerPlay />
        Start
      </Button>
      <Button variant="ghost" size="sm" onClick={() => onAct("stop")}>
        <IconPlayerStop />
        Stop
      </Button>
      <Button variant="ghost" size="sm" onClick={() => onAct("restart")}>
        <IconRefresh />
        Restart
      </Button>
      <Button variant="dangerGhost" size="sm" onClick={onRemove}>
        <IconTrash />
        Delete
      </Button>
      <Button variant="ghost" size="sm" iconOnly aria-label="Clear selection" onClick={onClear}>
        <IconX />
      </Button>
    </div>
  );
}
