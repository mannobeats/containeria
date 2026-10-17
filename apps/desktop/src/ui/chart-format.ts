const minutes = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });
const seconds = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** Time axis labels: seconds while the chart spans under ten minutes, so ticks don't repeat. */
export function timeTicks(ticks: number[]): string[] {
  const span = (ticks.at(-1) ?? 0) - (ticks[0] ?? 0);
  const format = span < 600 ? seconds : minutes;
  return ticks.map((tick) => format.format(tick * 1000));
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
  return [seconds.format(time * 1000), ...lines].join("\n");
}
