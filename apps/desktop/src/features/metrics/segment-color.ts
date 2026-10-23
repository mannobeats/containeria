import type { LedgerSegment } from "@/lib/ipc/bindings";

const PROJECT_COLORS = ["var(--s1)", "var(--s3)", "var(--s6)", "var(--s2)"] as const;

/** A project keeps its colour wherever it appears: same name, same colour. */
export function segmentColor(segment: Pick<LedgerSegment, "kind" | "label">): string {
  if (segment.kind === "kubernetes") {
    return "var(--s5)";
  }
  if (segment.kind === "standalone") {
    return "var(--s4)";
  }
  let hash = 0;
  for (const char of segment.label) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return PROJECT_COLORS[hash % PROJECT_COLORS.length] ?? "var(--s1)";
}
