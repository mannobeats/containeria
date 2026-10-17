import { IconExternalLink, IconLock } from "@tabler/icons-react";
import { openUrl } from "@tauri-apps/plugin-opener";

import type { IngressSummary, ServiceSummary } from "@/lib/ipc/bindings";
import { Chip } from "@/ui/chip";
import { type Column, ColumnTable } from "@/ui/column-table";
import { Dash } from "@/ui/dash";
import { Tile } from "@/ui/tile";

const open = (url: string) => () => {
  openUrl(url).catch(() => undefined);
};

const linkClass = "inline-flex items-center gap-1 text-brand-ink hover:underline";

function Name({ name }: { name: string }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <Tile icon="network" />
      <span className="truncate font-medium text-ink">{name}</span>
    </span>
  );
}

function FromMac({ service }: { service: ServiceSummary }) {
  if (service.fromMac) {
    return (
      <button type="button" className={linkClass} onClick={open(`http://${service.fromMac}`)}>
        {service.fromMac}
        <IconExternalLink className="size-3.5" aria-hidden />
      </button>
    );
  }
  return (
    <code className="font-mono text-mono-12 text-ink-3">{`${service.name}.${service.namespace}.svc`}</code>
  );
}

export function ServicesTable({ services }: { services: ServiceSummary[] }) {
  const columns: Column<ServiceSummary>[] = [
    { header: "Name", cell: (service) => <Name name={service.name} /> },
    {
      header: "Namespace",
      width: "w-[140px]",
      cell: (service) => <Chip>{service.namespace}</Chip>,
    },
    { header: "Type", width: "w-[110px]", cell: (service) => service.kind },
    {
      header: "Cluster IP",
      width: "w-[120px]",
      cell: (service) =>
        service.clusterIp ? (
          <code className="font-mono text-mono-12">{service.clusterIp}</code>
        ) : (
          <Dash />
        ),
    },
    {
      header: "Ports",
      width: "w-[150px]",
      cell: (service) => (
        <code className="font-mono text-mono-12 text-ink-3">
          {service.ports
            .map(
              (port) =>
                `${port.port}${port.target === String(port.port) ? "" : `→${port.target}`}/${port.protocol}`,
            )
            .join(", ")}
        </code>
      ),
    },
    { header: "From your Mac", cell: (service) => <FromMac service={service} /> },
  ];
  return (
    <ColumnTable
      label="Services"
      columns={columns}
      rows={services}
      rowKey={(service) => `${service.namespace}/${service.name}`}
    />
  );
}

type Route = IngressSummary["routes"][number] & { ingress: IngressSummary };

export function IngressTable({ ingresses }: { ingresses: IngressSummary[] }) {
  const routes: Route[] = ingresses.flatMap((ingress) =>
    ingress.routes.map((route) => ({ ...route, ingress })),
  );
  const columns: Column<Route>[] = [
    { header: "Name", cell: (route) => <Name name={route.ingress.name} /> },
    {
      header: "Namespace",
      width: "w-[140px]",
      cell: (route) => <Chip>{route.ingress.namespace}</Chip>,
    },
    {
      header: "Host",
      cell: (route) => (
        <button
          type="button"
          className={linkClass}
          onClick={open(`${route.ingress.tls ? "https" : "http"}://${route.host}${route.path}`)}
        >
          {route.host}
        </button>
      ),
    },
    {
      header: "Path",
      width: "w-[110px]",
      cell: (route) => <code className="font-mono text-mono-12">{route.path}</code>,
    },
    {
      header: "Backend",
      cell: (route) => <code className="font-mono text-mono-12 text-ink-3">{route.backend}</code>,
    },
    {
      header: "TLS",
      width: "w-[80px]",
      cell: (route) =>
        route.ingress.tls ? (
          <span className="inline-flex items-center gap-1">
            <IconLock className="size-3.5 text-ok-ink" aria-hidden />
            On
          </span>
        ) : (
          <span className="text-ink-3">Off</span>
        ),
    },
  ];
  return (
    <ColumnTable
      label="Ingress"
      columns={columns}
      rows={routes}
      rowKey={(route) =>
        `${route.ingress.namespace}/${route.ingress.name}/${route.host}${route.path}`
      }
    />
  );
}
