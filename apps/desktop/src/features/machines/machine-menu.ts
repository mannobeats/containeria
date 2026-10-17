import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { toast } from "sonner";

import type { Machine, MachineAction } from "@/lib/ipc/bindings";
import type { MenuEntry } from "@/ui/menu";

import { isRunning } from "./model";

type Handlers = {
  open: (tab?: string) => void;
  act: (action: MachineAction) => void;
  remove: () => void;
};

/** The same menu on a card's ⋯ button, on right-click and in the detail header. */
export function machineMenu(machine: Machine, { open, act, remove }: Handlers): MenuEntry[] {
  const running = isRunning(machine);
  const ip = machine.ipv4;
  return [
    running
      ? { label: "Open Terminal", onSelect: () => open("terminal") }
      : { label: "Start", onSelect: () => act("start") },
    { label: "Browse Files", onSelect: () => open("files"), disabled: !running },
    ...(ip
      ? [
          {
            label: "Copy IP Address",
            onSelect: () =>
              writeText(ip)
                .then(() => toast("Copied", { description: ip }))
                .catch(() => undefined),
          },
        ]
      : []),
    { kind: "separator" },
    { label: "Restart", onSelect: () => act("restart"), disabled: !running },
    { label: "Stop", onSelect: () => act("stop"), disabled: !running },
    { kind: "separator" },
    { label: "Delete Machine…", danger: true, onSelect: remove },
  ];
}
