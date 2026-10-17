import "uplot/dist/uPlot.min.css";

import { useEffect, useEffectEvent, useRef } from "react";
import uPlot from "uplot";

import { resolveColor } from "@/lib/resolve-color";
import { useIsDark } from "@/lib/theme";

import { readout, timeTicks } from "./chart-format";

/** `color` is any CSS colour, usually a series token such as `var(--s1)`. */
export type ChartSeries = { label: string; color: string; fill?: boolean };

type ChartProps = {
  /** Read by screen readers in place of the canvas. */
  label: string;
  series: ChartSeries[];
  /** `[times in seconds, ...one array per series]`. */
  data: uPlot.AlignedData;
  height: number;
  format: (value: number) => string;
  /** A bare line with no axes, for a sparkline. */
  spark?: boolean;
  /** A fixed top for the y axis, such as 100 for a percentage; otherwise it follows the data. */
  max?: number;
};

function options(
  host: HTMLElement,
  props: ChartProps,
  onCursor: (plot: uPlot) => void,
): uPlot.Options {
  const { series, height, spark = false, format, max } = props;
  const axis = {
    show: !spark,
    stroke: resolveColor(host, "var(--ink-3)"),
    font: "11px Geist Variable, sans-serif",
    ticks: { show: false },
  };
  return {
    width: host.clientWidth || 600,
    height,
    padding: spark ? [4, 0, 2, 0] : [8, 4, 0, 0],
    legend: { show: false },
    cursor: { y: false, points: { size: 7, width: 2, fill: resolveColor(host, "var(--surface)") } },
    scales: {
      x: { time: true },
      y: { range: (_, __, high) => [0, max ?? Math.max(high * 1.15, 1)] },
    },
    axes: [
      {
        ...axis,
        grid: { show: false },
        size: 26,
        space: 80,
        values: (_, ticks) => timeTicks(ticks),
      },
      {
        ...axis,
        grid: { show: !spark, stroke: resolveColor(host, "var(--line)"), width: 1 },
        size: 62,
        values: (_, ticks) => ticks.map((tick) => format(tick)),
      },
    ],
    series: [
      {},
      ...series.map((entry) => ({
        label: entry.label,
        stroke: resolveColor(host, entry.color),
        width: 1.5,
        points: { show: false },
        ...(entry.fill === false
          ? {}
          : {
              fill: resolveColor(host, `color-mix(in oklch, ${entry.color} 12%, transparent)`),
            }),
      })),
    ],
    hooks: { setCursor: [onCursor] },
  };
}

function tipText(chart: uPlot, props: ChartProps): string | null {
  const index = chart.cursor.idx;
  const time = index == null ? undefined : chart.data[0][index];
  if (index == null || time === undefined || props.spark) {
    return null;
  }
  const rows = props.series.map((entry, position) => ({
    label: entry.label,
    value: chart.data[position + 1]?.[index],
  }));
  return readout(time, rows, props.format);
}

/** The canvas itself. Built once; a new shape or theme remounts it through `key`. */
function Canvas(props: ChartProps) {
  const host = useRef<HTMLDivElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const plot = useRef<uPlot | null>(null);
  const showTip = useEffectEvent((chart: uPlot) => {
    const text = tipText(chart, props);
    if (tip.current) {
      tip.current.hidden = text === null;
      tip.current.textContent = text;
    }
  });
  const build = useEffectEvent(
    (element: HTMLDivElement) => new uPlot(options(element, props, showTip), props.data, element),
  );
  useEffect(() => {
    const element = host.current;
    if (!element) {
      return;
    }
    const chart = build(element);
    plot.current = chart;
    const observer = new ResizeObserver(() =>
      chart.setSize({ width: element.clientWidth, height: chart.height }),
    );
    observer.observe(element);
    return () => {
      observer.disconnect();
      chart.destroy();
      plot.current = null;
    };
  }, []);
  useEffect(() => {
    plot.current?.setData(props.data);
  }, [props.data]);
  return (
    <div className="relative">
      <div ref={host} role="img" aria-label={props.label} />
      <div
        ref={tip}
        hidden
        className="pointer-events-none absolute top-1 left-2 z-[5] rounded-md bg-[light-dark(oklch(0.995_0_0/0.94),oklch(0.3_0.005_255/0.94))] px-2 py-1.5 text-12 whitespace-pre text-ink shadow-2 tabular"
      />
    </div>
  );
}

/** A uPlot time series in the design's colours: light, fast, and redrawn when the theme flips. */
export function Chart(props: ChartProps) {
  const dark = useIsDark();
  const shape = props.series.map((entry) => `${entry.label}/${entry.color}/${entry.fill}`).join();
  return <Canvas key={`${dark}:${props.height}:${props.spark}:${props.max}:${shape}`} {...props} />;
}
