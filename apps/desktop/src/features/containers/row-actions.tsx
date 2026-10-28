import {
  IconDots,
  IconPlayerPlay,
  IconPlayerStop,
  IconRefresh,
  IconTerminal2,
} from "@tabler/icons-react";

import type { ContainerSummary } from "@/lib/ipc/bindings";
import { Button } from "@/ui/button";
import { rowActions } from "@/ui/classes";
import { IconAction } from "@/ui/icon-action";
import { Menu, type MenuEntry } from "@/ui/menu";

import type { ContainerCallbacks } from "./container-callbacks";
import { isRunning } from "./model";

type RowActionsProps = Pick<ContainerCallbacks, "act"> & {
  container: ContainerSummary;
  menu: MenuEntry[];
  onTerminal: () => void;
};

/** Start or stop, restart, terminal and the full menu: shown when the row is hovered or focused. */
export function RowActions({ container, menu, act, onTerminal }: RowActionsProps) {
  const running = isRunning(container);
  return (
    <span className={rowActions}>
      {running ? (
        <IconAction label="Stop" target={container.name} onClick={() => act([container], "stop")}>
          <IconPlayerStop />
        </IconAction>
      ) : (
        <IconAction label="Start" target={container.name} onClick={() => act([container], "start")}>
          <IconPlayerPlay />
        </IconAction>
      )}
      <IconAction
        label="Restart"
        target={container.name}
        onClick={() => act([container], "restart")}
      >
        <IconRefresh />
      </IconAction>
      <IconAction label="Terminal" target={container.name} disabled={!running} onClick={onTerminal}>
        <IconTerminal2 />
      </IconAction>
      <Menu entries={menu} align="end">
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          aria-label={`More for ${container.name}`}
          className="text-ink-3 hover:text-ink"
        >
          <IconDots />
        </Button>
      </Menu>
    </span>
  );
}
