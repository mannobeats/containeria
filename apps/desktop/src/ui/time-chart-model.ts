import type uPlot from "uplot";

export type TimeSeries = {
  label: string;
  /** A CSS colour, usually a token like `var(--s1)`. */
  color: string;
  values: (number | null)[];
};

/** uPlot's columns: seconds on x, then one column per series. */
export function chartData(times: number[], series: TimeSeries[]): uPlot.AlignedData {
  return [times.map((ms) => ms / 1000), ...series.map((line) => line.values)];
}

/** One "label  value" line per series at a sample, for the hover readout. */
export function tooltipRows(
  series: TimeSeries[],
  index: number,
  format: (value: number) => string,
): string[] {
  return series.map((line) => {
    const value = line.values[index];
    return `${line.label}  ${value === null || value === undefined ? "—" : format(value)}`;
  });
}

/**
 * Canvas can't read CSS variables or `light-dark()`, so let the browser resolve the colour on a
 * throwaway element and hand the computed value to uPlot.
 */
export function resolveColor(css: string): string {
  const probe = document.createElement("span");
  probe.style.color = css;
  probe.style.display = "none";
  document.body.append(probe);
  const color = getComputedStyle(probe).color;
  probe.remove();
  return color || css;
}
