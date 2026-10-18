import { Link, useNavigate } from "@tanstack/react-router";
import clsx from "clsx";

import { formatMemory, formatPercent } from "@/lib/format";
import type { ContainerSummary, ContainerUsage } from "@/lib/ipc/bindings";
import { logoFor } from "@/lib/logos";
import { Checkbox } from "@/ui/checkbox";
import { rowLink } from "@/ui/classes";
import { Dash } from "@/ui/dash";
import { ContextMenu } from "@/ui/menu";
import { Tile } from "@/ui/tile";

import { useRecreate } from "./api";
import type { ContainerCallbacks } from "./container-callbacks";
import { containerMenu } from "./container-menu";
import { ContainerStatus } from "./container-status";
import { isCrashed, isRunning } from "./model";
import { PortChips } from "./port-chips";
import { RowActions } from "./row-actions";

type ContainerRowProps = ContainerCallbacks & {
  container: ContainerSummary;
  usage: ContainerUsage | undefined;
  selected: boolean;
  onSelect: (selected: boolean) => void;
  onPick: (event: { metaKey: boolean; shiftKey: boolean }) => void;
  showImage: boolean;
};

function tileState(container: ContainerSummary): "on" | "off" | "bad" {
  if (isCrashed(container)) {
    return "bad";
  }
  return isRunning(container) ? "on" : "off";
}

export function ContainerRow({
  container,
  usage,
  selected,
  onSelect,
  onPick,
  showImage,
  act,
  remove,
}: ContainerRowProps) {
  const navigate = useNavigate();
  const running = isRunning(container);
  const open = (tab?: string) =>
    navigate({ to: "/containers/$id", params: { id: container.id }, search: tab ? { tab } : {} });
  const recreate = useRecreate();
  const menu = containerMenu(container, {
    open,
    act: (action) => act([container], action),
    remove: () => remove([container]),
    recreate: (pull) => recreate.mutate({ id: container.id, name: container.name, pull }),
  });
  return (
    <ContextMenu entries={menu}>
      <tr
        aria-selected={selected || undefined}
        onClick={onPick}
        className={clsx(
          "group/row h-9 transition-colors duration-140 hover:bg-hover data-[state=open]:bg-hover [&>td]:border-b-[0.5px] [&>td]:border-line",
          selected && "bg-select",
          !running && "[&>td]:text-ink-3",
        )}
      >
        <td className="w-11 pl-5">
          <Checkbox
            checked={selected}
            onCheckedChange={onSelect}
            label={`Select ${container.name}`}
          />
        </td>
        <td className="max-w-0 px-2.5">
          <Link
            to="/containers/$id"
            params={{ id: container.id }}
            className={rowLink}
            data-row-link
          >
            <Tile logo={logoFor(container.image)} state={tileState(container)} />
            <span
              className={clsx(
                "truncate",
                running ? "font-medium text-ink" : "font-[450] text-ink-3",
              )}
            >
              {container.name}
            </span>
          </Link>
        </td>
        {showImage ? (
          <td className="max-w-0 px-2.5">
            <span className="block truncate font-mono text-mono-12 text-ink-3">
              {container.image}
            </span>
          </td>
        ) : null}
        <td className="px-2.5">
          <PortChips ports={container.ports} />
        </td>
        <td className="px-2.5 text-right tabular">
          {running ? formatPercent(usage?.cpuPercent ?? null) : <Dash />}
        </td>
        <td className="px-2.5 text-right tabular">
          {running && usage ? formatMemory(usage.memoryBytes) : <Dash />}
        </td>
        <td className="max-w-0 px-2.5">
          <ContainerStatus container={container} />
        </td>
        <td className="pr-5 text-right">
          <RowActions
            container={container}
            menu={menu}
            act={act}
            onTerminal={() => open("terminal")}
          />
        </td>
      </tr>
    </ContextMenu>
  );
}
