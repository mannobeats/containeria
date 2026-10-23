import { copyText } from "@/lib/clipboard";
import type { Machine, MachineAction } from "@/lib/ipc/bindings";
import type { MenuEntry } from "@/ui/menu";

import { copyShellCommand, exportMachine, openInTerminal } from "./api";
import { isRunning } from "./model";

/** The sheets a machine's menu opens. */
export type MachineDialog = "clone" | "snapshot" | "delete";

type Handlers = {
  open: (tab?: string) => void;
  act: (action: MachineAction) => void;
  dialog: (dialog: MachineDialog) => void;
};

/** The same menu on a card's ⋯ button, on right-click and in the detail header. */
export function machineMenu(machine: Machine, { open, act, dialog }: Handlers): MenuEntry[] {
  const running = isRunning(machine);
  const ip = machine.ipv4;
  return [
    running
      ? { label: "Open Terminal", onSelect: () => open("terminal") }
      : { label: "Start", onSelect: () => act("start") },
    { label: "Browse Files", onSelect: () => open("files"), disabled: !running },
    {
      label: "Open in Terminal App",
      onSelect: () => openInTerminal(machine.name),
      disabled: !running,
    },
    { kind: "separator" },
    { label: "Take Snapshot…", onSelect: () => dialog("snapshot") },
    { label: "Clone…", onSelect: () => dialog("clone") },
    { label: "Export…", onSelect: () => exportMachine(machine.name).catch(() => undefined) },
    { kind: "separator" },
    ...(ip ? [{ label: "Copy IP Address", onSelect: () => copyText("IP address", ip) }] : []),
    { label: "Copy Shell Command", onSelect: () => copyShellCommand(machine.name) },
    { kind: "separator" },
    { label: "Restart", onSelect: () => act("restart"), disabled: !running },
    { label: "Stop", onSelect: () => act("stop"), disabled: !running },
    { kind: "separator" },
    { label: "Delete Machine…", danger: true, onSelect: () => dialog("delete") },
  ];
}
