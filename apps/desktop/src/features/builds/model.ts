import type { BuildRecord } from "@/lib/ipc/bindings";

/** Running builds first, then the newest. */
export function sortBuilds(builds: BuildRecord[]): BuildRecord[] {
  return builds.toSorted(
    (a, b) =>
      Number(b.status === "running") - Number(a.status === "running") ||
      b.startedAtMs - a.startedAtMs,
  );
}

export function runningCount(builds: BuildRecord[] | undefined): number {
  return builds?.filter((build) => build.status === "running").length ?? 0;
}

/** Older buildx leaves builds unnamed; the start of the id tells them apart. */
export function buildName(build: { id: string; name: string }): string {
  return build.name || `Build ${build.id.slice(0, 7)}`;
}

/** How long it took, or has taken so far: "0.4s", "5.2s", "1m 4s", "2h 5m". */
export function formatDuration(ms: number): string {
  const seconds = Math.max(0, ms) / 1000;
  if (seconds < 60) {
    return `${seconds < 10 ? seconds.toFixed(1) : Math.floor(seconds)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ${Math.floor(seconds % 60)}s`;
  }
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function elapsed(build: BuildRecord, now: number): number {
  return (build.completedAtMs ?? now) - build.startedAtMs;
}

/** "4 of 10 cached", or null while BuildKit hasn't counted the steps yet. */
export function cachedLabel(build: BuildRecord): string | null {
  return build.totalSteps > 0 ? `${build.cachedSteps} of ${build.totalSteps} cached` : null;
}

/** 0 to 1, or undefined while the step count isn't known: BuildKit counts steps at the end. */
export function buildProgress(build: BuildRecord): number | undefined {
  return build.totalSteps > 0 ? build.completedSteps / build.totalSteps : undefined;
}

/** A failure is the only state the tile marks; a canceled build fades. */
export function buildTileState(build: BuildRecord): "on" | "off" | "bad" {
  if (build.status === "failed") {
    return "bad";
  }
  return build.status === "canceled" ? "off" : "on";
}
