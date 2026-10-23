import { IconPlus, IconTrash } from "@tabler/icons-react";
import { useState } from "react";

import { queryKeys } from "@/app/query-keys";
import { useRemoveMany } from "@/app/use-remove-many";
import { useContainers } from "@/features/containers/api";
import { type ContainerSummary, commands, type NetworkSummary } from "@/lib/ipc/bindings";
import { type Selection, useSelection, useSelectionKeys } from "@/lib/use-selection";
import { Crumb, Page } from "@/shell/page";
import { Button } from "@/ui/button";
import { DeleteManySheet } from "@/ui/delete-many-sheet";
import { EmptyState } from "@/ui/empty-state";
import { ListToolbar } from "@/ui/list-toolbar";
import { Lede, PageHeading } from "@/ui/page-heading";
import { SelectionBar } from "@/ui/selection-bar";
import { HeadRow, SelectAll, Table } from "@/ui/table";

import { useNetworks } from "./api";
import { DeleteNetworkSheet } from "./delete-network-sheet";
import { matchesNetwork, undeletable } from "./model";
import { NetworkRow } from "./network-row";
import { NewNetworkSheet } from "./new-network-sheet";

type NetworkTableProps = {
  networks: NetworkSummary[];
  containers: ContainerSummary[];
  onDelete: (network: NetworkSummary) => void;
  selection: Selection;
};

function NetworkTable({ networks, containers, onDelete, selection }: NetworkTableProps) {
  return (
    <Table label="Networks">
      <colgroup>
        <col className="w-11" />
        <col />
        <col className="w-[100px]" />
        <col className="w-[150px]" />
        <col className="w-[130px]" />
        <col className="w-[260px]" />
        <col className="w-[60px]" />
      </colgroup>
      <HeadRow>
        <SelectAll selection={selection} label="Select all networks that can be deleted" />
        <th>Name</th>
        <th>Driver</th>
        <th>Subnet</th>
        <th>Gateway</th>
        <th>Containers</th>
        <th>
          <span className="sr-only">Actions</span>
        </th>
      </HeadRow>
      <tbody>
        {networks.map((network) => (
          <NetworkRow
            key={network.id}
            network={network}
            containers={containers}
            onDelete={onDelete}
            selection={selection}
          />
        ))}
      </tbody>
    </Table>
  );
}

export function NetworksPage() {
  const { data: networks } = useNetworks();
  const { data: containers } = useContainers();
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<NetworkSummary | null>(null);
  const all = networks ?? [];
  const own = all.filter((network) => !network.builtIn).length;
  const visible = all.filter((network) => matchesNetwork(network, query));
  const selection = useSelection(
    visible.filter((network) => !undeletable(network)).map((network) => network.id),
  );
  const chosen = visible.filter((network) => selection.has(network.id));
  const [removing, setRemoving] = useState<NetworkSummary[]>([]);
  const removeMany = useRemoveMany({
    remove: (network: NetworkSummary) => commands.networkRemove(network.id),
    name: (network) => network.name,
    noun: "network",
    invalidates: queryKeys.networks,
  });
  useSelectionKeys(selection, () => setRemoving(chosen));
  return (
    <Page crumbs={<Crumb>Networks</Crumb>}>
      <PageHeading
        title="Networks"
        action={
          <Button variant="brand" onClick={() => setCreating(true)}>
            <IconPlus />
            New network
          </Button>
        }
      >
        <Lede>
          {own} project {own === 1 ? "network" : "networks"} and {all.length - own} built in.
          Containers on the same network reach each other by service name.
        </Lede>
      </PageHeading>
      <ListToolbar query={query} onQuery={setQuery} placeholder="Filter networks" />
      <div className="pb-[72px]">
        {networks && visible.length === 0 ? (
          <EmptyState title="No networks match" />
        ) : (
          <NetworkTable
            networks={visible}
            containers={containers ?? []}
            onDelete={setDeleting}
            selection={selection}
          />
        )}
      </div>
      <SelectionBar count={chosen.length} label="Selected networks" onClear={selection.clear}>
        <Button variant="dangerGhost" size="sm" onClick={() => setRemoving(chosen)}>
          <IconTrash />
          Delete
        </Button>
      </SelectionBar>
      <DeleteManySheet
        names={removing.map((network) => network.name)}
        noun="network"
        onCancel={() => setRemoving([])}
        onConfirm={() => {
          removeMany.mutate(removing);
          setRemoving([]);
          selection.clear();
        }}
      >
        Containers created later can't join them by name. This can't be undone.
      </DeleteManySheet>
      {creating ? (
        <NewNetworkSheet
          open
          taken={all.map((network) => network.name)}
          onClose={() => setCreating(false)}
        />
      ) : null}
      <DeleteNetworkSheet network={deleting} onClose={() => setDeleting(null)} />
    </Page>
  );
}
