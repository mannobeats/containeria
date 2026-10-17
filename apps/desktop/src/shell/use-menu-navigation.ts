import { useRouter } from "@tanstack/react-router";

import { events } from "@/lib/ipc/bindings";
import { useTauriEvent } from "@/lib/ipc/use-tauri-event";

/** The native menu bar names a view by its path; open it. */
export function useMenuNavigation() {
  const router = useRouter();
  useTauriEvent(events.navigate, (path) => {
    router.navigate({ href: path }).catch(() => undefined);
  });
}
