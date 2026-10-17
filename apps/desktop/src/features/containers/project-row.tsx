import { IconChevronDown, IconPlayerPlay, IconPlayerStop, IconRefresh } from "@tabler/icons-react";
import clsx from "clsx";

import { segmentColor } from "@/features/metrics/segment-color";
import { formatMemory } from "@/lib/format";
import type { ContainerUsage } from "@/lib/ipc/bindings";
import { Button } from "@/ui/button";
import { IconAction } from "@/ui/icon-action";

import type { ContainerCallbacks } from "./container-callbacks";
import { type ContainerGroup, isRunning } from "./model";

type ProjectRowProps = Pick<ContainerCallbacks, "act"> & {
  group: ContainerGroup;
  usage: Map<string, ContainerUsage>;
  collapsed: boolean;
  onCollapse: () => void;
  columns: number;
};

/** The header row of a Compose project: its colour in the ledger, what runs, and project actions. */
export function ProjectRow({ group, usage, collapsed, onCollapse, columns, act }: ProjectRowProps) {
  const label = group.project ?? "Standalone";
  const up = group.containers.filter(isRunning);
  const memory = up.reduce(
    (total, container) => total + (usage.get(container.id)?.memoryBytes ?? 0),
    0,
  );
  return (
    <tr className="group/head h-10 bg-bg [&>td]:border-b-[0.5px] [&>td]:border-line">
      <td colSpan={columns} className="pt-1.5 pr-5 pl-3.5">
        <span className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            aria-expanded={!collapsed}
            aria-label={`${collapsed ? "Expand" : "Collapse"} ${label}`}
            onClick={onCollapse}
            className="text-ink-3"
          >
            <IconChevronDown
              className={clsx(
                "size-3.5 transition-transform duration-220 ease-out",
                collapsed && "-rotate-90",
              )}
            />
          </Button>
          <span
            aria-hidden
            className="size-2.5 shrink-0 rounded-[3px]"
            style={{
              background: segmentColor({ kind: group.project ? "project" : "standalone", label }),
            }}
          />
          <b className="text-13 font-semibold text-ink">{label}</b>
          <span className="text-12 text-ink-3">
            {up.length} of {group.containers.length} running
          </span>
          <span className="ml-auto text-12 text-ink-3 tabular">
            {up.length > 0 ? formatMemory(memory) : null}
          </span>
          {group.project ? (
            <span className="ml-2 inline-flex gap-0.5 opacity-0 transition-opacity duration-140 group-focus-within/head:opacity-100 group-hover/head:opacity-100">
              {up.length > 0 ? (
                <IconAction
                  label="Stop project"
                  target={label}
                  onClick={() => act(up, "stop", label)}
                >
                  <IconPlayerStop />
                </IconAction>
              ) : (
                <IconAction
                  label="Start project"
                  target={label}
                  onClick={() => act(group.containers, "start", label)}
                >
                  <IconPlayerPlay />
                </IconAction>
              )}
              <IconAction
                label="Restart project"
                target={label}
                onClick={() => act(group.containers, "restart", label)}
              >
                <IconRefresh />
              </IconAction>
            </span>
          ) : null}
        </span>
      </td>
    </tr>
  );
}
