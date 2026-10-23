import { openUrl } from "@tauri-apps/plugin-opener";

import type { Port } from "@/lib/ipc/bindings";
import { Dash } from "@/ui/dash";
import { Tip } from "@/ui/tooltip";

/** Published ports open in the browser; private ones aren't shown. */
export function PortChips({ ports }: { ports: Port[] }) {
  const published = ports.filter((port): port is Port & { host: number } => port.host !== null);
  if (published.length === 0) {
    return <Dash />;
  }
  return (
    <span className="flex min-w-0 gap-1 overflow-hidden">
      {published.slice(0, 3).map((port) => (
        <Tip key={`${port.host}-${port.protocol}`} label={`Open localhost:${port.host} ↗`}>
          <button
            type="button"
            onClick={() => openUrl(`http://localhost:${port.host}`).catch(() => undefined)}
            className="inline-flex h-5 items-center rounded-[5px] bg-fill px-[7px] font-mono text-mono-12 text-ink-2 transition-colors duration-140 hover:bg-brand-soft hover:text-brand-ink"
          >
            {port.host}
            {port.host === port.container ? null : (
              <span className="text-ink-3">:{port.container}</span>
            )}
          </button>
        </Tip>
      ))}
      {published.length > 3 ? (
        <span className="text-12 text-ink-3">+{published.length - 3}</span>
      ) : null}
    </span>
  );
}
