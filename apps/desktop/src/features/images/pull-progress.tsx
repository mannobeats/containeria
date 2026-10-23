import clsx from "clsx";

import { formatBytes } from "@/lib/format";
import { Progress } from "@/ui/progress";

import { layerFraction, type PullLayer } from "./model";

function layerStatus(layer: PullLayer): string {
  if (layer.done) {
    return "Done";
  }
  if (layer.status === "Downloading" && layer.total > 0) {
    return `${formatBytes(layer.current)} of ${formatBytes(layer.total)}`;
  }
  return layer.status;
}

/** One bar per layer while an image downloads and unpacks. */
export function PullProgress({ layers }: { layers: PullLayer[] }) {
  if (layers.length === 0) {
    return <p className="m-0 text-13 text-ink-3">Asking the registry for the image…</p>;
  }
  return (
    <ul aria-label="Layers" className="m-0 flex list-none flex-col gap-2.5 p-0">
      {layers.map((layer) => (
        <li
          key={layer.id}
          className="grid grid-cols-[110px_minmax(0,1fr)_130px] items-center gap-3"
        >
          <span className="font-mono text-mono-12 text-ink-3">{layer.id}</span>
          <Progress
            label={`Layer ${layer.id}`}
            value={layerFraction(layer)}
            className={clsx(layer.done && "[&>i]:bg-ok")}
          />
          <span
            className={clsx(
              "text-right text-12 tabular",
              layer.done ? "text-ok-ink" : "text-ink-3",
            )}
          >
            {layerStatus(layer)}
          </span>
        </li>
      ))}
    </ul>
  );
}
