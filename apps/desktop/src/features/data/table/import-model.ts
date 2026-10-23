import type {
  Column,
  ColumnMapping,
  ExportFormat,
  ImportedRows,
  ImportFormat,
} from "@/lib/ipc/bindings";

/** JSON for `.json`, `.ndjson` and `.jsonl`; everything else is read as CSV. */
export function importFormat(path: string): ImportFormat {
  return /\.(json|ndjson|jsonl)$/i.test(path) ? "json" : "csv";
}

/** The export format a save path asks for by its extension; CSV when it names none. */
export function exportFormat(path: string): ExportFormat {
  const extension = path.split(".").at(-1)?.toLowerCase();
  if (extension === "json" || extension === "sql") {
    return extension;
  }
  return "csv";
}

export function fileName(path: string): string {
  return path.split("/").at(-1) ?? path;
}

/** Each file column and the table column it goes into; `""` skips it. */
export type Matches = Record<string, string>;

const normalized = (name: string) => name.toLowerCase().replace(/[\s_-]/g, "");

/** Matches file columns to table columns by name, ignoring case, spaces, `_` and `-`. */
export function autoMatch(sources: string[], columns: Column[]): Matches {
  const taken = new Set<string>();
  const matches: Matches = {};
  for (const source of sources) {
    const column = columns.find(
      (candidate) =>
        !taken.has(candidate.name) && normalized(candidate.name) === normalized(source),
    );
    matches[source] = column?.name ?? "";
    if (column) {
      taken.add(column.name);
    }
  }
  return matches;
}

/** Sends `source` into `column`, taking that column away from any other file column. */
export function withMatch(matches: Matches, source: string, column: string): Matches {
  const next: Matches = {};
  for (const [name, target] of Object.entries(matches)) {
    next[name] = column !== "" && target === column ? "" : target;
  }
  next[source] = column;
  return next;
}

export function toMapping(sources: string[], matches: Matches): ColumnMapping[] {
  return sources.flatMap((source) => {
    const column = matches[source];
    return column ? [{ source, column }] : [];
  });
}

/** How much of the file is in, from 0 to 1. */
export function importedShare(step: ImportedRows): number {
  return step.bytesTotal > 0 ? Math.min(1, step.bytesRead / step.bytesTotal) : 0;
}

/** The first `count` rows, each with a key that stays put while the preview reloads. */
export function sampleRows(rows: (string | null)[][], count: number) {
  const seen = new Map<string, number>();
  return rows.slice(0, count).map((values) => {
    const content = JSON.stringify(values);
    const copy = (seen.get(content) ?? 0) + 1;
    seen.set(content, copy);
    return { key: `${content}#${copy}`, values };
  });
}
