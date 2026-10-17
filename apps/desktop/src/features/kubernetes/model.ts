import type { Cluster, ContainerSummary, Metrics, PodSummary } from "@/lib/ipc/bindings";

/**
 * Pod memory by `namespace/name`. k3s runs pods as Docker containers labelled with their pod, so
 * the Docker sampler already measures them; no metrics-server needed.
 */
export function podMemory(
  containers: ContainerSummary[] | undefined,
  metrics: Metrics | null | undefined,
): Map<string, number> {
  const usage = new Map(metrics?.containers.map((reading) => [reading.id, reading.memoryBytes]));
  const memory = new Map<string, number>();
  for (const container of containers ?? []) {
    if (container.pod !== null) {
      memory.set(container.pod, (memory.get(container.pod) ?? 0) + (usage.get(container.id) ?? 0));
    }
  }
  return memory;
}

export type Tab = "pods" | "deployments" | "services" | "ingress" | "config";

export const TABS: { value: Tab; label: string }[] = [
  { value: "pods", label: "Pods" },
  { value: "deployments", label: "Deployments" },
  { value: "services", label: "Services" },
  { value: "ingress", label: "Ingress" },
  { value: "config", label: "Config and secrets" },
];

export function asTab(value: string | undefined): Tab {
  return TABS.some((tab) => tab.value === value) ? (value as Tab) : "pods";
}

/** `null` means every namespace. */
export type Namespace = string | null;

type Named = { namespace: string; name: string };

/** Items in `namespace` whose name, namespace or `extra` fields contain the search. */
export function visible<Item extends Named>(
  items: Item[],
  namespace: Namespace,
  query: string,
  extra: (item: Item) => string[] = () => [],
): Item[] {
  const needle = query.trim().toLowerCase();
  return items.filter(
    (item) =>
      (namespace === null || item.namespace === namespace) &&
      (needle === "" ||
        [item.name, item.namespace, ...extra(item)].some((field) =>
          field.toLowerCase().includes(needle),
        )),
  );
}

/** Pods that need attention first, then by namespace and name. */
export function sortPods(pods: PodSummary[]): PodSummary[] {
  return pods.toSorted(
    (a, b) =>
      Number(b.problem !== null) - Number(a.problem !== null) ||
      `${a.namespace}/${a.name}`.localeCompare(`${b.namespace}/${b.name}`),
  );
}

export function crashing(cluster: Cluster | undefined): PodSummary[] {
  return cluster?.pods.filter((pod) => pod.problem !== null) ?? [];
}

export function tabCounts(cluster: Cluster, namespace: Namespace): Record<Tab, number> {
  const inNamespace = (items: Named[]) =>
    items.filter((item) => namespace === null || item.namespace === namespace).length;
  return {
    pods: inNamespace(cluster.pods),
    deployments: inNamespace(cluster.deployments),
    services: inNamespace(cluster.services),
    ingress: inNamespace(cluster.ingresses),
    config: inNamespace(cluster.config),
  };
}

/** The k3s version without its build suffix: "v1.35.0+k3s1" → "1.35.0". */
export function k3sVersion(version: string): string {
  return version.replace(/^v/, "").replace(/\+.*$/, "");
}
