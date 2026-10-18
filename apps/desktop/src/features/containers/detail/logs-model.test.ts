import { describe, expect, it } from "vitest";
import { useClock } from "@/lib/clock";
import type { LogEntry } from "@/lib/ipc/bindings";
import { appendLines, countErrors, filterLines, formatTime, MAX_LINES, toText } from "./logs-model";

const numbered = (entries: LogEntry[]) => appendLines([], entries);

const line = (
  message: string,
  level: LogEntry["level"] = "info",
  timestamp: string | null = null,
): LogEntry => ({
  stream: "stdout",
  timestamp,
  level,
  message,
});

describe("logs model", () => {
  const lines = numbered([
    line("ready"),
    line("slow query", "warning"),
    line("Connection refused", "error"),
    line("tick", "debug"),
  ]);

  it("filters by level and by text", () => {
    expect(filterLines(lines, "warnings", "").map((entry) => entry.message)).toEqual([
      "slow query",
      "Connection refused",
    ]);
    expect(filterLines(lines, "all", "CONNECTION").map((entry) => entry.message)).toEqual([
      "Connection refused",
    ]);
    expect(countErrors(lines)).toBe(1);
  });

  it("keeps a bounded number of lines", () => {
    const many = numbered(Array.from({ length: MAX_LINES }, (_, index) => line(String(index))));
    const next = appendLines(many, [line("newest")]);
    expect(next.at(-1)?.seq).toBe(MAX_LINES);
    expect(next).toHaveLength(MAX_LINES);
    expect(next.at(-1)?.message).toBe("newest");
    expect(next[0]?.message).toBe("1");
  });

  it("shows Docker's nanosecond stamps as local times to the millisecond", () => {
    const local = new Date(2026, 9, 17, 12, 4, 9, 877).toISOString().replace("Z", "000000Z");
    useClock.setState({ timeZone: undefined, hour12: false });
    expect(formatTime(local)).toBe("12:04:09.877");
    useClock.setState({ hour12: true });
    expect(formatTime(local)).toBe("12:04:09.877 PM");
    expect(formatTime(null)).toBe("");
    expect(formatTime("garbage")).toBe("");
  });

  it("exports plain text with stamps", () => {
    expect(toText([line("a", "info", "2026-10-17T00:00:00Z"), line("b")])).toBe(
      "2026-10-17T00:00:00Z a\nb",
    );
  });
});
