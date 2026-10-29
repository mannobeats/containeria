import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { toast } from "sonner";

import { errorMessage } from "./ipc/errors";

/** Copies `value` and says what was copied, or why it wasn't. */
export function copyText(label: string, value: string) {
  writeText(value)
    .then(() =>
      toast("Copied", {
        description: `${label}: ${value.length > 80 ? `${value.slice(0, 80)}…` : value}`,
      }),
    )
    .catch((error: unknown) =>
      toast.error(`${label} wasn't copied`, { description: errorMessage(error) }),
    );
}
