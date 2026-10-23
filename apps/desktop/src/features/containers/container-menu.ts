import { openUrl } from "@tauri-apps/plugin-opener";

import { copyText } from "@/lib/clipboard";
import type { ContainerAction, ContainerSummary } from "@/lib/ipc/bindings";
import type { MenuEntry } from "@/ui/menu";

import { isRunning } from "./model";

type Handlers = {
  open: (tab?: string) => void;
  act: (action: ContainerAction) => void;
  remove: () => void;
  recreate: (pull: boolean) => void;
};

/** The same menu on the row's ⋯ button and on right-click. */
export function containerMenu(
  container: ContainerSummary,
  { open, act, remove, recreate }: Handlers,
): MenuEntry[] {
  const running = isRunning(container);
  const port = container.ports.find((candidate) => candidate.host !== null);
  return [
    { label: "Open", onSelect: () => open() },
    { label: "Logs", onSelect: () => open("logs") },
    { label: "Terminal", onSelect: () => open("terminal"), disabled: !running },
    { label: "Files", onSelect: () => open("files") },
    { kind: "separator" },
    ...(port?.host
      ? [
          {
            label: `Open localhost:${port.host}`,
            onSelect: () => openUrl(`http://localhost:${port.host}`).catch(() => undefined),
          },
        ]
      : []),
    { label: "Copy Name", onSelect: () => copyText("Name", container.name) },
    { label: "Copy ID", onSelect: () => copyText("ID", container.id.slice(0, 12)) },
    { kind: "separator" },
    running
      ? { label: "Stop", onSelect: () => act("stop") }
      : { label: "Start", onSelect: () => act("start") },
    { label: "Restart", onSelect: () => act("restart") },
    container.state === "paused"
      ? { label: "Resume", onSelect: () => act("resume") }
      : { label: "Pause", onSelect: () => act("pause"), disabled: !running },
    { label: "Kill", onSelect: () => act("kill"), disabled: !running },
    { kind: "separator" },
    { label: "Recreate", onSelect: () => recreate(false) },
    { label: "Recreate with Latest Image", onSelect: () => recreate(true) },
    { kind: "separator" },
    { label: "Delete…", danger: true, onSelect: remove },
  ];
}
