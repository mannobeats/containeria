import type { VolumeFile, VolumeSummary } from "@/lib/ipc/bindings";

export type VolumeFilter = "all" | "used" | "unused";

export function volumeName(volume: VolumeSummary): string {
  return volume.anonymous ? `${volume.name.slice(0, 12)}…` : volume.name;
}

export function matchesVolume(volume: VolumeSummary, filter: VolumeFilter, query: string): boolean {
  const used = volume.usedBy.length > 0;
  if ((filter === "used" && !used) || (filter === "unused" && used)) {
    return false;
  }
  const needle = query.trim().toLowerCase();
  const fields = [
    volume.name,
    volume.project ?? "",
    ...volume.usedBy.map((user) => user.container),
  ];
  return needle === "" || fields.some((field) => field.toLowerCase().includes(needle));
}

export function volumeStats(volumes: VolumeSummary[]) {
  const unattached = volumes.filter((volume) => volume.usedBy.length === 0);
  const size = (list: VolumeSummary[]) =>
    list.reduce((total, volume) => total + (volume.sizeBytes ?? 0), 0);
  return {
    count: volumes.length,
    totalBytes: size(volumes),
    unattached: unattached.length,
    unattachedBytes: size(unattached),
  };
}

/** Docker's rule for volume names; `null` when the name is fine. */
export function nameProblem(name: string, taken: string[]): string | null {
  if (name === "") {
    return null;
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(name)) {
    return "Use letters, numbers, dots, dashes and underscores, starting with a letter or number.";
  }
  return taken.includes(name) ? "A volume with this name exists." : null;
}

/** `pg/base` + `16384` → `pg/base/16384`; `..` goes up one folder. */
export function joinPath(folder: string, entry: string): string {
  const parts = folder.split("/").filter(Boolean);
  if (entry === "..") {
    parts.pop();
  } else {
    parts.push(entry);
  }
  return parts.join("/");
}

export function isFolder(entry: VolumeFile): boolean {
  return entry.kind === "directory";
}

/** `shop_pgdata-2026-10-17.tar.gz` → `shop_pgdata`: the name a backup was taken from. */
export function volumeFromBackup(path: string): string {
  const file = path.split("/").at(-1) ?? "";
  return file.replace(/\.(tar\.gz|tgz|tar)$/i, "").replace(/-\d{4}-\d{2}-\d{2}$/, "");
}
