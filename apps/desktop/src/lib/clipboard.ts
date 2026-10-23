import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { toast } from "sonner";

/** Copies `value` and says what was copied. */
export function copyText(label: string, value: string) {
  writeText(value)
    .then(() =>
      toast("Copied", {
        description: `${label}: ${value.length > 80 ? `${value.slice(0, 80)}…` : value}`,
      }),
    )
    .catch(() => undefined);
}
