import "uplot/dist/uPlot.min.css";

import { useEffect, useEffectEvent, useRef } from "react";
import uPlot from "uplot";

import { useIsDark } from "@/lib/theme";

import { chartData, resolveColor, type TimeSeries, tooltipRows } from "./time-chart-model";

type TimeChartProps = {
  /** Read by screen readers in place of the drawing. */
  label: string;
  /** Sample times in milliseconds since 1970. */
  times: number[];
  series: TimeSeries[];
  format: (value: number) => string;
  height?: number;
  /** Fixed top of the y axis; otherwise it follows the data. */
  max?: number;
};

const time = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/**
 * A line chart over time on uPlot, coloured from the design tokens, with a hover readout. It is
 * redrawn from scratch when the appearance changes, since canvas colours are resolved once.
 */
export function TimeChart(props: TimeChartProps) {
  const dark = useIsDark();
  return <Plot key={dark ? "dark" : "light"} {...props} />;
}

function Plot({ label, times, series, format, height = 120, max }: TimeChartProps) {
  const host = useRef<HTMLDivElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const plot = useRef<uPlot | null>(null);
  const names = series.map((line) => `${line.label}:${line.color}`).join("|");
  const formatValue = useEffectEvent(format);
  const latest = useEffectEvent(() => chartData(times, series));
  const describe = useEffectEvent((index: number) => tooltipRows(series, index, format));

  useEffect(() => {
    const element = host.current;
    if (!element) {
      return;
    }
    const ink = resolveColor("var(--ink-3)");
    const grid = resolveColor("var(--line)");
    const font = "11px Geist Variable, system-ui";
    const lines = names.split("|").map((name) => {
      const color = resolveColor(name.slice(name.indexOf(":") + 1));
      return {
        label: name.slice(0, name.indexOf(":")),
        stroke: color,
        width: 1.5,
        points: { show: false },
      };
    });
    const chart = new uPlot(
      {
        width: element.clientWidth || 600,
        height,
        padding: [8, 4, 0, 0],
        legend: { show: false },
        cursor: { y: false, points: { size: 7 } },
        scales: {
          x: { time: true },
          y: { range: (_, __, high) => [0, max ?? Math.max(high * 1.15, 1)] },
        },
        axes: [
          { stroke: ink, font, size: 26, space: 80, grid: { show: false }, ticks: { show: false } },
          {
            stroke: ink,
            font,
            size: 62,
            grid: { stroke: grid, width: 1 },
            ticks: { show: false },
            values: (_, values) => values.map((value) => formatValue(value)),
          },
        ],
        series: [{}, ...lines],
        hooks: {
          setCursor: [
            (self) => {
              const index = self.cursor.idx;
              const box = tip.current;
              if (!box) {
                return;
              }
              if (index === null || index === undefined) {
                box.style.opacity = "0";
                return;
              }
              const at = self.data[0][index] ?? 0;
              box.textContent = [time.format(at * 1000), ...describe(index)].join("\n");
              box.style.opacity = "1";
              box.style.transform = `translateX(${Math.min(self.valToPos(at, "x") + 54, element.clientWidth - 160)}px)`;
            },
          ],
        },
      },
      latest(),
      element,
    );
    plot.current = chart;
    const resize = new ResizeObserver(() => chart.setSize({ width: element.clientWidth, height }));
    resize.observe(element);
    return () => {
      resize.disconnect();
      chart.destroy();
      plot.current = null;
    };
  }, [height, max, names]);

  useEffect(() => {
    plot.current?.setData(chartData(times, series));
  });

  return (
    <div role="img" aria-label={label} className="relative mt-1.5 min-h-[120px]">
      <div ref={host} />
      <div
        ref={tip}
        aria-hidden
        className="pointer-events-none absolute top-1 left-0 z-[5] min-w-[140px] whitespace-pre rounded-md bg-[light-dark(oklch(0.995_0_0/0.94),oklch(0.3_0.005_255/0.94))] px-[9px] py-[7px] text-12 text-ink opacity-0 shadow-2 transition-opacity duration-140 tabular"
      />
    </div>
  );
}
