import { IconLink, IconPlugConnectedX, IconTrash } from "@tabler/icons-react";
import { getRouteApi, Link } from "@tanstack/react-router";
import { useState } from "react";

import type { NetworkDetail, NetworkEndpoint } from "@/lib/ipc/bindings";
import { Crumb, Page } from "@/shell/page";
import { ParentCrumb } from "@/shell/parent-crumb";
import { Button } from "@/ui/button";
import { rowLink } from "@/ui/classes";
import { Dash } from "@/ui/dash";
import { EmptyState } from "@/ui/empty-state";
import { IconAction } from "@/ui/icon-action";
import { Kv } from "@/ui/kv";
import { ResourceHeader } from "@/ui/resource-header";
import { HeadRow, Row, RowActions, Table } from "@/ui/table";
import { Tile } from "@/ui/tile";

import { useDisconnectNetwork, useNetwork } from "./api";
import { ConnectSheet } from "./connect-sheet";
import { DeleteNetworkSheet } from "./delete-network-sheet";

const route = getRouteApi("/networks/$id");

function Endpoints({ detail }: { detail: NetworkDetail }) {
  const disconnect = useDisconnectNetwork();
  const leave = (endpoint: NetworkEndpoint) =>
    disconnect.mutate({
      network: detail.network.id,
      container: endpoint.containerId,
      networkName: detail.network.name,
    });
  if (detail.endpoints.length === 0) {
    return (
      <EmptyState
        art={<IconPlugConnectedX className="size-5" aria-hidden />}
        title="No containers on this network"
        className="py-8"
      />
    );
  }
  return (
    <Table label="Connected containers">
      <colgroup>
        <col />
        <col className="w-[150px]" />
        <col className="w-[160px]" />
        <col className="w-[60px]" />
      </colgroup>
      <HeadRow>
        <th>Container</th>
        <th>IPv4</th>
        <th>MAC</th>
        <th>
          <span className="sr-only">Actions</span>
        </th>
      </HeadRow>
      <tbody>
        {detail.endpoints.map((endpoint) => (
          <Row key={endpoint.containerId}>
            <td className="max-w-0">
              <Link
                to="/containers/$id"
                params={{ id: endpoint.containerId }}
                className={rowLink}
                data-row-link
              >
                <Tile />
                <span className="truncate text-ink">{endpoint.container}</span>
              </Link>
            </td>
            <td className="font-mono text-mono-12">{endpoint.ipv4 ?? <Dash />}</td>
            <td className="font-mono text-mono-12 text-ink-3">{endpoint.mac ?? <Dash />}</td>
            <RowActions>
              <IconAction
                label="Disconnect"
                target={endpoint.container}
                onClick={() => leave(endpoint)}
              >
                <IconPlugConnectedX />
              </IconAction>
            </RowActions>
          </Row>
        ))}
      </tbody>
    </Table>
  );
}

function Details({ detail }: { detail: NetworkDetail }) {
  const { network } = detail;
  return (
    <Kv
      rows={[
        { label: "Driver", value: network.driver },
        {
          label: "Subnet",
          value: network.subnet ? (
            <code className="font-mono text-mono-12">{network.subnet}</code>
          ) : (
            <Dash />
          ),
        },
        {
          label: "Gateway",
          value: network.gateway ? (
            <code className="font-mono text-mono-12">{network.gateway}</code>
          ) : (
            <Dash />
          ),
        },
        { label: "Scope", value: network.scope },
        { label: "Internal", value: network.internal ? "Yes, no internet" : "No" },
        { label: "IPv6", value: network.ipv6 ? "On" : "Off" },
      ]}
    />
  );
}

export function NetworkPage() {
  const { id } = route.useParams();
  const { data: detail, isError } = useNetwork(id);
  const [dialog, setDialog] = useState<"connect" | "delete" | null>(null);
  const crumbs = (
    <>
      <ParentCrumb to="/networks" label="Networks" />
      <Crumb>{detail?.network.name ?? id.slice(0, 12)}</Crumb>
    </>
  );
  if (isError || !detail) {
    return (
      <Page crumbs={crumbs}>
        {isError ? (
          <EmptyState
            art={<Tile icon="network" size="xl" />}
            title="This network was deleted"
            className="h-full"
          />
        ) : null}
      </Page>
    );
  }
  const { network } = detail;
  return (
    <Page crumbs={crumbs}>
      <ResourceHeader
        face={<Tile icon="network" size="lg" />}
        title={network.name}
        meta={
          <>
            <span>{network.driver}</span>
            {network.subnet ? (
              <span className="font-mono text-mono-12">{network.subnet}</span>
            ) : null}
            <span>{detail.endpoints.length} containers</span>
          </>
        }
        actions={
          <>
            <Button
              disabled={network.driver === "null" || network.driver === "host"}
              onClick={() => setDialog("connect")}
            >
              <IconLink />
              Connect container
            </Button>
            {network.builtIn ? null : (
              <Button
                variant="dangerGhost"
                iconOnly
                aria-label="Delete network"
                onClick={() => setDialog("delete")}
              >
                <IconTrash />
              </Button>
            )}
          </>
        }
      />
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(300px,380px)] items-start gap-8 pt-1.5 pr-5 pb-10 max-[1180px]:grid-cols-1 max-[1180px]:pl-5">
        <section className="min-w-0">
          <Endpoints detail={detail} />
        </section>
        <aside className="min-w-0 max-[1180px]:pl-0">
          <h2 className="m-0 mb-2 text-13 font-semibold text-ink">Details</h2>
          <Details detail={detail} />
        </aside>
      </div>
      {dialog === "connect" ? (
        <ConnectSheet network={network} onClose={() => setDialog(null)} />
      ) : null}
      <DeleteNetworkSheet
        network={dialog === "delete" ? network : null}
        onClose={() => setDialog(null)}
      />
    </Page>
  );
}
