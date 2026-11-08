import type { Inventory, MigrationSource, MovableVolume } from "@/lib/ipc/bindings";

/** `colima:default`, `orbStack:`: one key per engine, since a kind can have several. */
export function sourceKey(source: MigrationSource): string {
  return `${source.kind}:${source.instance ?? ""}`;
}

/** `a`, `a and b`, `a, b and c`. */
export function listed(names: string[]): string {
  if (names.length < 2) {
    return names[0] ?? "";
  }
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/**
 * The volumes a running container uses that this copy reads: the ones picked, and the ones the
 * picked containers bring along. Copying them now may catch a database mid-write.
 */
export function volumesInUse(
  inventory: Inventory,
  volumes: ReadonlySet<string>,
  containers: ReadonlySet<string>,
): MovableVolume[] {
  const picked = new Set(
    inventory.containers
      .filter((container) => containers.has(container.id))
      .map((container) => container.name),
  );
  return inventory.volumes.filter(
    (volume) =>
      volume.inUseBy.length > 0 &&
      (volumes.has(volume.name) || volume.inUseBy.some((name) => picked.has(name))),
  );
}
