import type { ContainerSummary, ImageSummary, PullProgress } from "@/lib/ipc/bindings";

export type ImageFilter = "all" | "used" | "unused" | "dangling";

export function imageKind(image: ImageSummary): Exclude<ImageFilter, "all"> {
  if (image.dangling) {
    return "dangling";
  }
  return image.containers > 0 ? "used" : "unused";
}

export function imageName(image: ImageSummary): string {
  return image.dangling ? "Dangling build layer" : (image.repository ?? image.id);
}

/** The 12 hex characters people recognise an image by. */
export function shortId(id: string): string {
  return id.replace(/^sha256:/, "").slice(0, 12);
}

export type ImageStats = Record<Exclude<ImageFilter, "all">, { count: number; bytes: number }> & {
  totalBytes: number;
};

export function imageStats(images: ImageSummary[]): ImageStats {
  const stats: ImageStats = {
    used: { count: 0, bytes: 0 },
    unused: { count: 0, bytes: 0 },
    dangling: { count: 0, bytes: 0 },
    totalBytes: 0,
  };
  for (const image of images) {
    const bucket = stats[imageKind(image)];
    bucket.count += 1;
    bucket.bytes += image.sizeBytes;
    stats.totalBytes += image.sizeBytes;
  }
  return stats;
}

export function matchesImage(image: ImageSummary, filter: ImageFilter, query: string): boolean {
  if (filter !== "all" && imageKind(image) !== filter) {
    return false;
  }
  const needle = query.trim().toLowerCase();
  return (
    needle === "" ||
    [image.id, ...image.references].some((field) => field.toLowerCase().includes(needle))
  );
}

export type PullLayer = {
  id: string;
  status: string;
  current: number;
  total: number;
  done: boolean;
};

const FINISHED = ["Pull complete", "Already exists", "Download complete"];

/** Folds one progress line into the per-layer view the pull sheet draws. */
export function applyPullProgress(layers: PullLayer[], progress: PullProgress): PullLayer[] {
  const { layer: id } = progress;
  if (
    id === null ||
    progress.status.startsWith("Pulling from") ||
    progress.status.startsWith("Digest")
  ) {
    return layers;
  }
  const done = FINISHED.some((status) => progress.status.startsWith(status));
  const existing = layers.find((layer) => layer.id === id);
  const next: PullLayer = {
    id,
    status: progress.status,
    current: progress.current ?? existing?.current ?? 0,
    total: progress.total ?? existing?.total ?? 0,
    done: done || existing?.done === true,
  };
  return existing ? layers.map((layer) => (layer.id === id ? next : layer)) : [...layers, next];
}

/** A layer counts fully once done; while downloading, by bytes. */
export function layerFraction(layer: PullLayer): number {
  if (layer.done) {
    return 1;
  }
  return layer.total > 0 ? Math.min(layer.current / layer.total, 1) : 0;
}

export function pullFraction(layers: PullLayer[]): number {
  return layers.length === 0
    ? 0
    : layers.reduce((total, layer) => total + layerFraction(layer), 0) / layers.length;
}

/** `postgres` + `18` → `postgres:18`; a typed full reference is used as written. */
export function pullReference(term: string, selected: string | null, tag: string): string {
  if (selected) {
    return `${selected}:${tag.trim() || "latest"}`;
  }
  return term.trim();
}

/** Containers created from the image, matched by any of its references (`redis` means `redis:latest`). */
export function usersOf(image: ImageSummary, containers: ContainerSummary[]): ContainerSummary[] {
  const names = new Set(image.references);
  return containers.filter(
    (container) =>
      names.has(container.image) ||
      names.has(`${container.image}:latest`) ||
      container.image === image.id,
  );
}
