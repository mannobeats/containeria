import { IconPlus } from "@tabler/icons-react";
import { useState } from "react";

import { useContainers } from "@/features/containers/api";
import type { ContainerSummary, NetworkSummary } from "@/lib/ipc/bindings";
import { Crumb, Page } from "@/shell/page";
import { Button } from "@/ui/button";
import { EmptyState } from "@/ui/empty-state";
import { ListToolbar } from "@/ui/list-toolbar";
import { Lede, PageHeading } from "@/ui/page-heading";
import { HeadRow, Table } from "@/ui/table";

import { useNetworks } from "./api";
import { DeleteNetworkSheet } from "./delete-network-sheet";
import { matchesNetwork } from "./model";
import { NetworkRow } from "./network-row";
import { NewNetworkSheet } from "./new-network-sheet";

type NetworkTableProps = {
  networks: NetworkSummary[];
  containers: ContainerSummary[];
  onDelete: (network: NetworkSummary) => void;
};

function NetworkTable({ networks, containers, onDelete }: NetworkTableProps) {
  return (
    <Table label="Networks">
      <colgroup>
        <col />
        <col className="w-[100px]" />
        <col className="w-[150px]" />
        <col className="w-[130px]" />
        <col className="w-[260px]" />
        <col className="w-[60px]" />
      </colgroup>
      <HeadRow>
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
      <div className="pb-10">
        {networks && visible.length === 0 ? (
          <EmptyState title="No networks match" />
        ) : (
          <NetworkTable networks={visible} containers={containers ?? []} onDelete={setDeleting} />
        )}
      </div>
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
