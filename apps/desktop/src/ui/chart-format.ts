import { formatClock } from "@/lib/clock";

/** Time axis labels: seconds while the chart spans under ten minutes, so ticks don't repeat. */
export function timeTicks(ticks: number[]): string[] {
  const span = (ticks.at(-1) ?? 0) - (ticks[0] ?? 0);
  return ticks.map((tick) => formatClock(tick * 1000, span < 600));
}

/** The hover readout: the time, then "label  value" per series, "—" where a series has a gap. */
export function readout(
  time: number,
  rows: { label: string; value: number | null | undefined }[],
  format: (value: number) => string,
): string {
  const lines = rows.map(
    ({ label, value }) =>
      `${label}  ${value === null || value === undefined ? "—" : format(value)}`,
  );
  return [formatClock(time * 1000, true), ...lines].join("\n");
}
