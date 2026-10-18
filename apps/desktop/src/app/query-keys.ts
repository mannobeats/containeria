import type { ObjectKind } from "@/lib/ipc/bindings";

/** Root keys. A Docker event of one kind invalidates everything under its root. */
export const queryKeys = {
  engine: ["engine"],
  metrics: ["metrics"],
  containers: ["containers"],
  images: ["images"],
  /** Under images: an image event or a finished build or Compose run refreshes the history too. */
  builds: ["images", "builds"],
  volumes: ["volumes"],
  networks: ["networks"],
  domains: ["domains"],
  kubernetes: ["kubernetes"],
  storage: ["storage"],
} as const;

export const keyForKind: Record<ObjectKind, readonly string[]> = {
  container: queryKeys.containers,
  image: queryKeys.images,
  volume: queryKeys.volumes,
  network: queryKeys.networks,
};
