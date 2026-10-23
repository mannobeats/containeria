import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { toast } from "sonner";

import { copyText } from "@/lib/clipboard";
import type { Connection } from "@/lib/ipc/bindings";
import type { MenuEntry } from "@/ui/menu";

/** `host:port`, or the file for SQLite. */
export function address(connection: Connection): string {
  if (connection.engine === "sqlite") {
    return connection.file ?? "";
  }
  return connection.port ? `${connection.host}:${connection.port}` : connection.host;
}

type Handlers = { open: () => void; edit: () => void; remove: () => void };

/** The same menu on a saved connection's ⋯ button, its row and its sidebar link. */
export function connectionMenu(
  connection: Connection,
  { open, edit, remove }: Handlers,
): MenuEntry[] {
  const safe = `${connection.engine}://${connection.user ? `${connection.user}@` : ""}${address(connection)}${connection.database ? `/${connection.database}` : ""}`;
  return [
    { label: "Open", onSelect: open },
    { label: "Edit Connection…", onSelect: edit },
    { kind: "separator" },
    {
      label: "Copy Connection String",
      onSelect: () =>
        writeText(safe)
          .then(() => toast("Copied without the password", { description: safe }))
          .catch(() => undefined),
    },
    {
      label: connection.engine === "sqlite" ? "Copy file path" : "Copy address",
      onSelect: () => copyText("Address", address(connection)),
    },
    { kind: "separator" },
    { label: "Remove Connection…", danger: true, onSelect: remove },
  ];
}
