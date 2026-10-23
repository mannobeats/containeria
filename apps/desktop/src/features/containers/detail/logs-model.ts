import { formatPreciseClock } from "@/lib/clock";
import type { Level, LogEntry } from "@/lib/ipc/bindings";

/** Lines kept in memory; older ones scroll away, as in Terminal. */
export const MAX_LINES = 5000;

export type LevelFilter = "all" | "warnings" | "errors";

/** A line plus a sequence number that stays its key while older lines scroll away. */
export type LogLine = LogEntry & { seq: number };

export function appendLines(lines: LogLine[], batch: LogEntry[]): LogLine[] {
  const first = (lines.at(-1)?.seq ?? -1) + 1;
  const next = lines.concat(batch.map((entry, offset) => ({ ...entry, seq: first + offset })));
  return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next;
}

const shown: Record<LevelFilter, ReadonlySet<Level>> = {
  all: new Set(["error", "warning", "info", "debug"]),
  warnings: new Set(["error", "warning"]),
  errors: new Set(["error"]),
};

export function filterLines(lines: LogLine[], level: LevelFilter, query: string): LogLine[] {
  const needle = query.trim().toLowerCase();
  return lines.filter(
    (line) =>
      shown[level].has(line.level) &&
      (needle === "" || line.message.toLowerCase().includes(needle)),
  );
}

export function countErrors(lines: LogEntry[]): number {
  return lines.filter((line) => line.level === "error").length;
}

/** `2026-10-17T12:04:09.877000000Z` → `8:04:09.877 AM` on the clock Settings picks. */
export function formatTime(timestamp: string | null): string {
  if (!timestamp) {
    return "";
  }
  const ms = Date.parse(timestamp.replace(/(\.\d{3})\d+/, "$1"));
  return Number.isNaN(ms) ? "" : formatPreciseClock(ms);
}

/** The lines as plain text, for Copy and Download. */
export function toText(lines: LogEntry[]): string {
  return lines
    .map((line) => (line.timestamp ? `${line.timestamp} ${line.message}` : line.message))
    .join("\n");
}
