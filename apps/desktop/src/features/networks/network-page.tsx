import { IconLink, IconPlugConnectedX, IconTrash } from "@tabler/icons-react";
import { getRouteApi, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { copyText } from "@/lib/clipboard";
import { plural } from "@/lib/format";
import type { NetworkDetail, NetworkEndpoint } from "@/lib/ipc/bindings";
import { errorMessage, isCommandError } from "@/lib/ipc/errors";
import { Crumb, Page } from "@/shell/page";
import { ParentCrumb } from "@/shell/parent-crumb";
import { Button } from "@/ui/button";
import { rowLink } from "@/ui/classes";
import { Dash } from "@/ui/dash";
import { EmptyState } from "@/ui/empty-state";
import { IconAction } from "@/ui/icon-action";
import { Kv } from "@/ui/kv";
import { ContextMenu, type MenuEntry } from "@/ui/menu";
import { ResourceHeader } from "@/ui/resource-header";
import { HeadRow, Row, RowActions, Table } from "@/ui/table";
import { Tile } from "@/ui/tile";
import { Tip } from "@/ui/tooltip";

import { useDisconnectNetwork, useNetwork } from "./api";
import { ConnectSheet } from "./connect-sheet";
import { DeleteNetworkSheet } from "./delete-network-sheet";
import { hostAddress, undeletable } from "./model";

const route = getRouteApi("/networks/$id");

function Endpoints({ detail }: { detail: NetworkDetail }) {
  const navigate = useNavigate();
  const disconnect = useDisconnectNetwork();
  const leave = ({ containerId, container }: NetworkEndpoint) =>
    disconnect.mutate({
      network: detail.network.id,
      container: containerId,
      networkName: detail.network.name,
      containerName: container,
    });
  const menu = (endpoint: NetworkEndpoint): MenuEntry[] => {
    const { containerId, container, ipv4 } = endpoint;
    return [
      {
        label: "Open",
        onSelect: () => navigate({ to: "/containers/$id", params: { id: containerId } }),
      },
      { kind: "separator" },
      ...(ipv4
        ? [{ label: "Copy IP Address", onSelect: () => copyText("IP address", hostAddress(ipv4)) }]
        : []),
      { label: "Copy Name", onSelect: () => copyText("Name", container) },
      { kind: "separator" },
      { label: "Disconnect", danger: true, onSelect: () => leave(endpoint) },
    ];
  };
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
          <ContextMenu key={endpoint.containerId} entries={menu(endpoint)}>
            <Row>
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
          </ContextMenu>
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

function Unreadable({ error, retry }: { error: unknown; retry: () => void }) {
  const gone = isCommandError(error) && error.kind === "notFound";
  return (
    <EmptyState
      art={<Tile icon="network" size="xl" />}
      title={gone ? "This network was deleted" : "This network couldn't be read"}
      className="h-full"
      actions={gone ? null : <Button onClick={retry}>Try Again</Button>}
    >
      {gone ? null : errorMessage(error)}
    </EmptyState>
  );
}

export function NetworkPage() {
  const { id } = route.useParams();
  const { data: detail, error, refetch } = useNetwork(id);
  const [dialog, setDialog] = useState<"connect" | "delete" | null>(null);
  const crumbs = (
    <>
      <ParentCrumb to="/networks" label="Networks" />
      <Crumb>{detail?.network.name ?? id.slice(0, 12)}</Crumb>
    </>
  );
  if (error) {
    return (
      <Page crumbs={crumbs}>
        <Unreadable error={error} retry={() => refetch().catch(() => undefined)} />
      </Page>
    );
  }
  if (!detail) {
    return <Page crumbs={crumbs}>{null}</Page>;
  }
  const { network } = detail;
  const blocked = undeletable(network);
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
            <span>{plural(detail.endpoints.length, "container")}</span>
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
              <Tip label={blocked ?? "Delete network"}>
                <Button
                  variant="dangerGhost"
                  iconOnly
                  aria-label={blocked ?? "Delete network"}
                  aria-disabled={blocked !== undefined}
                  onClick={() => (blocked ? undefined : setDialog("delete"))}
                >
                  <IconTrash />
                </Button>
              </Tip>
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
