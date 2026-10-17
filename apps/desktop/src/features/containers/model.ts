import type { ContainerSummary } from "@/lib/ipc/bindings";

export type Filter = "all" | "running" | "stopped";

export type ContainerGroup = { id: string; project: string | null; containers: ContainerSummary[] };

export const isRunning = (container: ContainerSummary) =>
  container.state === "running" || container.state === "restarting";

/** `Exited (137) 2 minutes ago` → 137. `null` for a clean exit or a running container. */
export function exitCode(container: ContainerSummary): number | null {
  const match = /^Exited \((\d+)\)/.exec(container.status);
  const code = match?.[1] === undefined ? 0 : Number(match[1]);
  return code === 0 ? null : code;
}

export function isCrashed(container: ContainerSummary): boolean {
  return container.state === "dead" || exitCode(container) !== null;
}

export function matches(container: ContainerSummary, filter: Filter, query: string): boolean {
  if (filter === "running" && !isRunning(container)) {
    return false;
  }
  if (filter === "stopped" && isRunning(container)) {
    return false;
  }
  const needle = query.trim().toLowerCase();
  return (
    needle === "" ||
    [container.name, container.image, container.project ?? ""].some((field) =>
      field.toLowerCase().includes(needle),
    )
  );
}

/** Compose projects alphabetically, then containers that belong to none. */
export function groupByProject(containers: ContainerSummary[]): ContainerGroup[] {
  const groups = new Map<string, ContainerGroup>();
  for (const container of containers) {
    const id = container.project ?? "";
    const group = groups.get(id) ?? {
      id: id || "standalone",
      project: container.project,
      containers: [],
    };
    group.containers.push(container);
    groups.set(id, group);
  }
  return [...groups.values()].sort((a, b) => {
    if (a.project === null || b.project === null) {
      return a.project === null ? 1 : -1;
    }
    return a.project.localeCompare(b.project);
  });
}

export function filterOptions(
  containers: ContainerSummary[],
): { value: Filter; label: string; count: number }[] {
  const running = containers.filter(isRunning).length;
  return [
    { value: "all", label: "All", count: containers.length },
    { value: "running", label: "Running", count: running },
    { value: "stopped", label: "Stopped", count: containers.length - running },
  ];
}

export function emptyTitle(filter: Filter, query: string): string {
  if (query) {
    return `No containers match “${query}”`;
  }
  return filter === "running" ? "Nothing is running" : "No stopped containers";
}
