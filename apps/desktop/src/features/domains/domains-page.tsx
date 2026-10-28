import { IconPlus, IconRefresh } from "@tabler/icons-react";
import { useState } from "react";

import type { CustomRoute, DomainRoute, DomainsStatus } from "@/lib/ipc/bindings";
import { errorMessage } from "@/lib/ipc/errors";
import { Crumb, Page } from "@/shell/page";
import { Button } from "@/ui/button";
import { ConfirmSheet } from "@/ui/confirm-sheet";
import { EmptyState } from "@/ui/empty-state";
import { Skeleton } from "@/ui/progress";
import { Tile } from "@/ui/tile";

import { useDomains, useRemoveRoute, useSaveRoute, useSetDomainsEnabled } from "./api";
import { DomainsSettings } from "./domains-settings";
import { RouteSheet } from "./route-sheet";
import { RouteTable } from "./route-table";
import { SetupBanners } from "./setup-banners";

function TurnOn() {
  const enable = useSetDomainsEnabled();
  return (
    <EmptyState
      art={<Tile icon="domain" size="xl" />}
      title="Give every container a name"
      className="h-full"
      actions={
        <Button
          variant="brand"
          size="lg"
          loading={enable.isPending}
          onClick={() => enable.mutate(true)}
        >
          Turn on domains
        </Button>
      }
    >
      Reach <code className="font-mono text-mono-13">web.shop.containeria.local</code> instead of
      localhost:3001, over HTTPS. Containeria runs a small DNS server and proxy on this Mac only.
    </EmptyState>
  );
}

/** `null` while closed, the route being edited, or `"new"` to add one. */
type Editing = CustomRoute | "new" | null;

function asCustom(route: DomainRoute): CustomRoute {
  return {
    host: route.host,
    container: route.container,
    port: route.port ?? 80,
    https: route.https,
  };
}

function Domains({ status }: { status: DomainsStatus }) {
  const save = useSaveRoute();
  const remove = useRemoveRoute();
  const [editing, setEditing] = useState<Editing>(null);
  const [removing, setRemoving] = useState<DomainRoute | null>(null);
  const up = status.routes.filter((route) => route.down === null).length;
  return (
    <>
      <div className="flex items-center gap-3 px-5 pt-[18px] pb-3.5">
        <h1 className="m-0 mr-auto text-20 font-semibold tracking-[-0.012em] text-ink">Domains</h1>
        <Button variant="brand" onClick={() => setEditing("new")}>
          <IconPlus />
          Add route
        </Button>
      </div>
      <p className="m-0 max-w-[72ch] px-5 pb-3 text-14 text-ink-2 [&_b]:font-semibold [&_b]:text-ink">
        <b className="tabular">
          {up} of {status.routes.length}
        </b>{" "}
        routes are up. Every container gets a name under{" "}
        <span className="font-mono text-ink">.{status.tld}</span>, no ports to remember.
      </p>
      <SetupBanners status={status} />
      <RouteTable
        status={status}
        onEdit={(route) => setEditing(asCustom(route))}
        onRemove={setRemoving}
      />
      <DomainsSettings status={status} />
      {editing ? (
        <RouteSheet
          editing={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSave={(route) =>
            save.mutate(
              { route, replaces: editing === "new" ? null : editing.host },
              { onSuccess: () => setEditing(null) },
            )
          }
        />
      ) : null}
      <ConfirmSheet
        open={removing !== null}
        onOpenChange={(open) => (open ? undefined : setRemoving(null))}
        title={`Remove ${removing?.host ?? "route"}?`}
        action="Remove route"
        onConfirm={() => {
          if (removing) {
            remove.mutate(removing.host);
          }
          setRemoving(null);
        }}
      >
        Requests to {removing?.host} stop reaching {removing?.container}. The container keeps
        running.
      </ConfirmSheet>
    </>
  );
}

function LoadFailed({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <EmptyState
      art={<Tile icon="domain" size="xl" />}
      title="Containeria couldn't read the domains"
      className="h-full"
      actions={
        <Button onClick={onRetry}>
          <IconRefresh />
          Try again
        </Button>
      }
    >
      {errorMessage(error)}
    </EmptyState>
  );
}

export function DomainsPage() {
  const { data: status, error, refetch } = useDomains();
  return (
    <Page crumbs={<Crumb>Domains</Crumb>}>
      {status === undefined && error ? (
        <LoadFailed error={error} onRetry={() => refetch().catch(() => undefined)} />
      ) : null}
      {status === undefined && !error ? <Skeleton className="m-5 h-4 w-96" /> : null}
      {status && !status.enabled ? <TurnOn /> : null}
      {status?.enabled ? <Domains status={status} /> : null}
    </Page>
  );
}
