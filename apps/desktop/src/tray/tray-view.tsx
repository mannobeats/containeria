import {
  IconAppWindow,
  IconPlayerPlay,
  IconPlayerStop,
  IconPower,
  IconSettings,
} from "@tabler/icons-react";
import { type ReactNode, useEffect } from "react";

import { useEngineEvents } from "@/app/use-engine-events";
import { useContainerAction, useContainers } from "@/features/containers/api";
import { isRunning } from "@/features/containers/model";
import { isServing, useEngineControl, useEngineStatus } from "@/features/engine/api";
import { usageById, useMetrics } from "@/features/metrics/api";
import { MemoryLedger } from "@/features/metrics/memory-ledger";
import { fitWindow } from "@/lib/fit-window";
import { formatMemory, plural } from "@/lib/format";
import { type ContainerSummary, commands, events } from "@/lib/ipc/bindings";
import { logoFor } from "@/lib/logos";
import { AppMark } from "@/ui/app-mark";
import { Button } from "@/ui/button";
import { IconAction } from "@/ui/icon-action";
import { ContextMenu, type MenuEntry } from "@/ui/menu";
import { Tile } from "@/ui/tile";

const rowClass =
  "group flex h-[30px] w-full items-center gap-2 rounded-sm px-2 text-left text-13 text-ink transition-colors duration-140 hover:bg-[light-dark(oklch(0_0_0/0.06),oklch(1_0_0/0.08))] data-[state=open]:bg-[light-dark(oklch(0_0_0/0.06),oklch(1_0_0/0.08))]";

function Section({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <section className="border-t-[0.5px] border-line px-1.5 py-2">
      {label ? (
        <h2 className="m-0 px-2 pt-1 pb-1 text-12 font-medium text-ink-3">{label}</h2>
      ) : null}
      {children}
    </section>
  );
}

/** Asks the main window to show the container, then brings it forward. */
function openInWindow(container: ContainerSummary) {
  events.navigate
    .emit(`/containers/${container.id}`)
    .then(() => commands.windowShowMain())
    .catch(() => undefined);
}

function Running() {
  const { data: containers } = useContainers();
  const { data: metrics } = useMetrics();
  const action = useContainerAction();
  const usage = usageById(metrics);
  const running =
    containers?.filter((container) => container.pod === null && isRunning(container)) ?? [];
  if (running.length === 0) {
    return <p className="m-0 px-2 py-1 text-13 text-ink-3">Nothing is running.</p>;
  }
  return (
    <ul className="m-0 max-h-[196px] list-none overflow-auto p-0">
      {running.map((container) => {
        const menu: MenuEntry[] = [
          { label: "Open in Containeria", onSelect: () => openInWindow(container) },
          { kind: "separator" },
          {
            label: "Stop",
            onSelect: () => action.mutate({ containers: [container], action: "stop" }),
          },
          {
            label: "Restart",
            onSelect: () => action.mutate({ containers: [container], action: "restart" }),
          },
        ];
        return (
          <ContextMenu key={container.id} entries={menu}>
            <li className={rowClass}>
              <Tile logo={logoFor(container.image)} size="sm" />
              <span className="min-w-0 flex-1 truncate">{container.name}</span>
              <span className="opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                <IconAction
                  label="Stop"
                  target={container.name}
                  onClick={() => action.mutate({ containers: [container], action: "stop" })}
                >
                  <IconPlayerStop />
                </IconAction>
              </span>
              <span className="w-14 shrink-0 text-right text-12 text-ink-3 tabular">
                {formatMemory(usage.get(container.id)?.memoryBytes ?? 0)}
              </span>
            </li>
          </ContextMenu>
        );
      })}
    </ul>
  );
}

function Header() {
  const { data: status } = useEngineStatus();
  const { data: containers } = useContainers();
  const control = useEngineControl();
  const serving = isServing(status?.phase);
  const count =
    containers?.filter((container) => container.pod === null && isRunning(container)).length ?? 0;
  return (
    <header className="flex items-center gap-2.5 px-3.5 pt-3 pb-2.5">
      <AppMark size={26} />
      <div className="min-w-0 flex-1">
        <b className="block text-13 font-semibold text-ink">Containeria</b>
        <span className="block text-12 text-ink-3">
          {serving ? `Engine running · ${plural(count, "container")}` : "Engine stopped"}
        </span>
      </div>
      {status?.phase === "external" ? null : (
        <Button
          size="sm"
          loading={control.isPending}
          onClick={() => control.mutate(serving ? "stop" : "start")}
        >
          {serving ? <IconPlayerStop /> : <IconPlayerPlay />}
          {serving ? "Stop" : "Start"}
        </Button>
      )}
    </header>
  );
}

/** The menu bar popover: the engine at a glance, what runs, and the way back to the window. */
export function TrayView() {
  useEngineEvents();
  useEffect(() => {
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        commands.windowHide().catch(() => undefined);
      }
    };
    addEventListener("keydown", dismiss);
    return () => removeEventListener("keydown", dismiss);
  }, []);
  const { data: metrics } = useMetrics();
  const ledger = metrics?.ledger;
  return (
    <div ref={fitWindow} className="rounded-[10px] bg-bg text-ink-2">
      <Header />
      <div className="px-3.5 pb-3">
        <span className="mb-1.5 flex justify-between text-12 text-ink-3">
          Memory
          <b className="font-medium text-ink tabular">
            {ledger
              ? `${formatMemory(ledger.usedBytes)} of ${formatMemory(ledger.totalBytes)}`
              : "—"}
          </b>
        </span>
        <MemoryLedger ledger={ledger} size="sm" />
      </div>
      <Section label="Running">
        <Running />
      </Section>
      <Section>
        <button
          type="button"
          className={rowClass}
          onClick={() => commands.windowShowMain().catch(() => undefined)}
        >
          <IconAppWindow className="text-ink-3" aria-hidden />
          Open Containeria
        </button>
        <button
          type="button"
          className={rowClass}
          onClick={() => commands.settingsOpen("general").catch(() => undefined)}
        >
          <IconSettings className="text-ink-3" aria-hidden />
          Settings…
        </button>
        <button
          type="button"
          className={rowClass}
          onClick={() => commands.appQuit().catch(() => undefined)}
        >
          <IconPower className="text-ink-3" aria-hidden />
          Quit Containeria
        </button>
      </Section>
    </div>
  );
}
