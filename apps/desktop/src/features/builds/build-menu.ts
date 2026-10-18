import { copyText } from "@/lib/clipboard";
import type { BuildRecord } from "@/lib/ipc/bindings";
import type { MenuEntry } from "@/ui/menu";

type Handlers = { open?: () => void; remove: () => void };

/** The same menu on the row's ⋯ button, on right-click and on the build's page. */
export function buildMenu(build: BuildRecord, { open, remove }: Handlers): MenuEntry[] {
  return [
    ...(open ? [{ label: "Open", onSelect: open }, { kind: "separator" as const }] : []),
    { label: "Copy Build ID", onSelect: () => copyText("Build ID", build.id) },
    { kind: "separator" },
    {
      label: "Remove from History",
      danger: true,
      disabled: build.status === "running",
      onSelect: remove,
    },
  ];
}
