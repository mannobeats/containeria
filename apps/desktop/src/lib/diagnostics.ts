import { save } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";

import { commands } from "./ipc/bindings";
import { errorMessage } from "./ipc/errors";

/** `containeria-diagnostics-2026-10-17.tar.gz`, dated so several don't overwrite each other. */
export function diagnosticsName(now: Date): string {
  return `containeria-diagnostics-${now.toISOString().slice(0, 10)}.tar.gz`;
}

/** Asks where to save, then writes a diagnostics bundle there for an issue report. */
export function collectDiagnostics() {
  save({ title: "Save diagnostics", defaultPath: diagnosticsName(new Date()) })
    .then((path) => {
      if (!path) {
        return;
      }
      const saving = toast.loading("Collecting diagnostics…");
      commands
        .diagnosticsCollect(path)
        .then(() =>
          toast.success("Saved the diagnostics", {
            id: saving,
            description: "Versions, engine status and VM logs. No container settings or secrets.",
            action: { label: "Show in Finder", onClick: () => revealItemInDir(path) },
          }),
        )
        .catch((error: unknown) =>
          toast.error("The diagnostics weren't saved", {
            id: saving,
            description: errorMessage(error),
          }),
        );
    })
    .catch(() => undefined);
}
