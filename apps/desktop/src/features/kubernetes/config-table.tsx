import { formatAge } from "@/lib/format";
import type { ConfigSummary } from "@/lib/ipc/bindings";
import { Chip } from "@/ui/chip";
import { type Column, Table } from "@/ui/table";
import { Tile } from "@/ui/tile";

import type { KubeSheet } from "./kube-sheet";

export function ConfigTable({
  config,
  open,
}: {
  config: ConfigSummary[];
  open: (sheet: KubeSheet) => void;
}) {
  const columns: Column<ConfigSummary>[] = [
    {
      header: "Name",
      cell: (item) => (
        <button
          type="button"
          onClick={() => open({ kind: "config", config: item })}
          className="flex min-w-0 items-center gap-2 text-left after:absolute after:inset-0"
        >
          <Tile icon={item.kind === "secret" ? "settings" : "data"} />
          <span className="truncate font-medium text-ink">{item.name}</span>
        </button>
      ),
    },
    { header: "Namespace", width: "w-[140px]", cell: (item) => <Chip>{item.namespace}</Chip> },
    {
      header: "Kind",
      width: "w-[170px]",
      cell: (item) =>
        item.kind === "secret" ? (
          <span>
            Secret <span className="font-mono text-mono-12 text-ink-3">{item.secretType}</span>
          </span>
        ) : (
          "Config map"
        ),
    },
    {
      header: "Keys",
      cell: (item) => (
        <span className="flex gap-1 overflow-hidden">
          {item.keys.map((key) => (
            <Chip key={key} mono>
              {key}
            </Chip>
          ))}
        </span>
      ),
    },
    {
      header: "Age",
      width: "w-[60px]",
      align: "right",
      cell: (item) => <span className="text-ink-3">{formatAge(item.createdAt)}</span>,
    },
  ];
  return (
    <Table
      label="Config and secrets"
      columns={columns}
      rows={config}
      rowKey={(item) => `${item.kind}/${item.namespace}/${item.name}`}
    />
  );
}
