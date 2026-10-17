import clsx from "clsx";
import { type RefObject, useEffect, useEffectEvent, useRef } from "react";

import type { ContainerSummary, ContainerUsage } from "@/lib/ipc/bindings";
import { useMediaQuery } from "@/lib/use-media-query";
import { Checkbox } from "@/ui/checkbox";

import type { ContainerCallbacks } from "./container-callbacks";
import { ContainerRow } from "./container-row";
import type { ContainerGroup } from "./model";
import { ProjectRow } from "./project-row";

type ContainerTableProps = ContainerCallbacks & {
  groups: ContainerGroup[];
  usage: Map<string, ContainerUsage>;
  selected: ReadonlySet<string>;
  onSelect: (ids: string[], selected: boolean) => void;
  collapsed: ReadonlySet<string>;
  onCollapse: (group: string) => void;
  hot: string | null;
  onHot: (segment: string | null) => void;
};

/** The image column only fits beside the others in a wide window. */
const WIDE = "(min-width: 1360px)";

const headClass =
  "[&>th]:sticky [&>th]:top-0 [&>th]:z-[2] [&>th]:h-[30px] [&>th]:border-b-[0.5px] [&>th]:border-line [&>th]:bg-bg [&>th]:px-2.5 [&>th]:text-left [&>th]:text-12 [&>th]:font-medium [&>th]:text-ink-3";

function headerState(
  all: ContainerSummary[],
  selected: ReadonlySet<string>,
): boolean | "indeterminate" {
  const count = all.filter((container) => selected.has(container.id)).length;
  if (count === 0) {
    return false;
  }
  return count === all.length ? true : "indeterminate";
}

/** Reports which project's rows the pointer is over, so the ledger can light it up. */
function useHoveredSegment(
  table: RefObject<HTMLTableElement | null>,
  onHot: (segment: string | null) => void,
) {
  const hover = useEffectEvent(onHot);
  useEffect(() => {
    const element = table.current;
    if (!element) {
      return;
    }
    const over = (event: PointerEvent) => {
      const body =
        event.target instanceof Element
          ? event.target.closest<HTMLElement>("tbody[data-segment]")
          : null;
      hover(body?.dataset.segment ?? null);
    };
    const leave = () => hover(null);
    element.addEventListener("pointerover", over);
    element.addEventListener("pointerleave", leave);
    return () => {
      element.removeEventListener("pointerover", over);
      element.removeEventListener("pointerleave", leave);
    };
  }, [table]);
}

export function ContainerTable({
  groups,
  usage,
  selected,
  onSelect,
  collapsed,
  onCollapse,
  hot,
  onHot,
  act,
  remove,
}: ContainerTableProps) {
  const wide = useMediaQuery(WIDE);
  const table = useRef<HTMLTableElement>(null);
  useHoveredSegment(table, onHot);
  const all = groups.flatMap((group) => group.containers);
  return (
    <table ref={table} className="w-full table-fixed border-separate border-spacing-0 text-13">
      <colgroup>
        <col className="w-11" />
        <col />
        {wide ? <col className="w-[20%]" /> : null}
        <col className="w-[132px]" />
        <col className="w-[76px]" />
        <col className="w-[92px]" />
        <col className="w-[150px]" />
        <col className="w-[116px]" />
      </colgroup>
      <thead>
        <tr className={headClass}>
          <th className="pl-5!">
            <Checkbox
              checked={headerState(all, selected)}
              onCheckedChange={(checked) =>
                onSelect(
                  all.map((container) => container.id),
                  checked,
                )
              }
              label="Select all containers"
            />
          </th>
          <th>Name</th>
          {wide ? <th>Image</th> : null}
          <th>Ports</th>
          <th className="text-right!">CPU</th>
          <th className="text-right!">Memory</th>
          <th>Status</th>
          <th>
            <span className="sr-only">Actions</span>
          </th>
        </tr>
      </thead>
      {groups.map((group) => {
        const segment = group.project ? `project:${group.project}` : "standalone";
        const open = !collapsed.has(group.id);
        return (
          <tbody
            key={group.id}
            data-segment={segment}
            className={clsx(
              "transition-opacity duration-220",
              hot !== null && hot !== segment && "opacity-45",
            )}
          >
            <ProjectRow
              group={group}
              usage={usage}
              collapsed={!open}
              onCollapse={() => onCollapse(group.id)}
              columns={wide ? 8 : 7}
              act={act}
            />
            {open
              ? group.containers.map((container) => (
                  <ContainerRow
                    key={container.id}
                    container={container}
                    usage={usage.get(container.id)}
                    selected={selected.has(container.id)}
                    onSelect={(checked) => onSelect([container.id], checked)}
                    showImage={wide}
                    act={act}
                    remove={remove}
                  />
                ))
              : null}
          </tbody>
        );
      })}
    </table>
  );
}
