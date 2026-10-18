import { IconPlayerPlay, IconPlayerStop, IconRefresh, IconTrash } from "@tabler/icons-react";

import type { ContainerAction } from "@/lib/ipc/bindings";
import { Button } from "@/ui/button";
import { SelectionBar } from "@/ui/selection-bar";

type BulkBarProps = {
  count: number;
  onAct: (action: ContainerAction) => void;
  onRemove: () => void;
  onClear: () => void;
};

/** Floats over the list while containers are selected. */
export function BulkBar({ count, onAct, onRemove, onClear }: BulkBarProps) {
  return (
    <SelectionBar count={count} label="Selected containers" onClear={onClear}>
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
    </SelectionBar>
  );
}
