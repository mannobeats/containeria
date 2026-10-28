import type { ContainerSummary, ContainerUsage } from "@/lib/ipc/bindings";
import { useMediaQuery } from "@/lib/use-media-query";
import { Checkbox } from "@/ui/checkbox";
import { openRowOnClick } from "@/ui/row-click";

import type { ContainerCallbacks } from "./container-callbacks";
import { ContainerRow } from "./container-row";
import type { ContainerGroup } from "./model";
import { ProjectRow } from "./project-row";

type ContainerTableProps = ContainerCallbacks & {
  groups: ContainerGroup[];
  /** Each group's containers before filtering, by group `id`, for its project actions. */
  members: Map<string, ContainerSummary[]>;
  usage: Map<string, ContainerUsage>;
  selected: ReadonlySet<string>;
  onSelect: (ids: string[], selected: boolean) => void;
  /** A ⌘- or ⇧-click on a row. */
  onPick: (id: string, event: { metaKey: boolean; shiftKey: boolean }) => void;
  collapsed: ReadonlySet<string>;
  onCollapse: (group: string) => void;
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

export function ContainerTable({
  groups,
  members,
  usage,
  selected,
  onSelect,
  onPick,
  collapsed,
  onCollapse,
  act,
  remove,
}: ContainerTableProps) {
  const wide = useMediaQuery(WIDE);
  const all = groups.flatMap((group) => group.containers);
  return (
    <table
      ref={openRowOnClick}
      className="w-full table-fixed border-separate border-spacing-0 text-13"
    >
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
        const open = !collapsed.has(group.id);
        return (
          <tbody key={group.id}>
            <ProjectRow
              group={group}
              members={members.get(group.id) ?? group.containers}
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
                    onPick={(event) => onPick(container.id, event)}
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
