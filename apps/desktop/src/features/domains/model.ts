import type { DomainPorts, DomainRoute, RouteKind } from "@/lib/ipc/bindings";

/** The URL a route opens at, with the proxy's port when it couldn't take 80 or 443. */
export function routeUrl(route: DomainRoute, ports: DomainPorts | null): string {
  const scheme = route.https ? "https" : "http";
  const port = route.https ? ports?.https : ports?.http;
  const standard = route.https ? 443 : 80;
  return port === undefined || port === standard
    ? `${scheme}://${route.host}`
    : `${scheme}://${route.host}:${port}`;
}

export type RouteGroup = { kind: RouteKind; label: string; routes: DomainRoute[] };

/**
 * The user's routes first, then one per container, then Kubernetes services. Empty groups are left
 * out.
 */
export function groupRoutes(routes: DomainRoute[]): RouteGroup[] {
  const groups: RouteGroup[] = [
    {
      kind: "custom",
      label: "Your routes",
      routes: routes.filter((route) => route.kind === "custom"),
    },
    {
      kind: "container",
      label: "Containers",
      routes: routes.filter((route) => route.kind === "container"),
    },
    {
      kind: "service",
      label: "Kubernetes services",
      routes: routes.filter((route) => route.kind === "service"),
    },
  ];
  return groups.filter((group) => group.routes.length > 0);
}

/** The hosts of the user's routes other than `editing`, which a save must not take over. */
export function otherCustomHosts(routes: DomainRoute[], editing: string | null): string[] {
  return routes
    .filter((route) => route.kind === "custom" && route.host !== editing)
    .map((route) => route.host);
}

/** What the status column says. */
export function routeState(route: DomainRoute): string {
  if (route.down === "stopped") {
    return "Stopped";
  }
  return route.down === "notPublished" ? "Port not published" : "Up";
}

const HOST =
  /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** The same rule the Rust side enforces: lowercase labels of letters, digits and dashes, two or more. */
export function isValidHost(host: string): boolean {
  return HOST.test(host.trim().toLowerCase());
}
