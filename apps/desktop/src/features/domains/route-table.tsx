import type { DomainRoute, DomainsStatus } from "@/lib/ipc/bindings";
import { CxIcon } from "@/ui/cx-icon";
import { EmptyState } from "@/ui/empty-state";

import { DomainRow } from "./domain-row";
import { groupRoutes, routeUrl } from "./model";

type RouteTableProps = {
  status: DomainsStatus;
  onEdit: (route: DomainRoute) => void;
  onRemove: (route: DomainRoute) => void;
};

const headClass =
  "[&>th]:h-[30px] [&>th]:border-b-[0.5px] [&>th]:border-line [&>th]:bg-bg [&>th]:px-2.5 [&>th]:text-left [&>th]:text-12 [&>th]:font-medium [&>th]:text-ink-3";

export function RouteTable({ status, onEdit, onRemove }: RouteTableProps) {
  const groups = groupRoutes(status.routes);
  if (groups.length === 0) {
    return (
      <EmptyState title="No routes yet">
        Containers get a name as soon as they run. Add your own with Add route.
      </EmptyState>
    );
  }
  return (
    <table className="w-full table-fixed border-separate border-spacing-0 text-13">
      <colgroup>
        <col />
        <col className="w-[28%]" />
        <col className="w-[120px]" />
        <col className="w-[150px]" />
        <col className="w-[104px]" />
      </colgroup>
      <thead>
        <tr className={headClass}>
          <th className="pl-5!">Domain</th>
          <th>Points to</th>
          <th>HTTPS</th>
          <th>Status</th>
          <th>
            <span className="sr-only">Actions</span>
          </th>
        </tr>
      </thead>
      {groups.map((group) => (
        <tbody key={group.kind}>
          <tr className="h-[34px] [&>td]:border-b-[0.5px] [&>td]:border-line">
            <td colSpan={5} className="pt-2.5 pl-5 text-12 font-semibold text-ink-2">
              <span className="flex items-center gap-2">
                <CxIcon
                  name={group.kind === "custom" ? "domain" : "container"}
                  className="size-3.5 text-ink-3"
                />
                {group.label}
                <span className="font-[450] text-ink-3 tabular">{group.routes.length}</span>
              </span>
            </td>
          </tr>
          {group.routes.map((route) => (
            <DomainRow
              key={route.host}
              route={route}
              url={routeUrl(route, status.ports)}
              caTrusted={status.caTrusted}
              onEdit={() => onEdit(route)}
              onRemove={() => onRemove(route)}
            />
          ))}
        </tbody>
      ))}
    </table>
  );
}
