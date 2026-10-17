import { useQueryClient } from "@tanstack/react-query";

import { events } from "@/lib/ipc/bindings";
import { useTauriEvent } from "@/lib/ipc/use-tauri-event";

import { keyForKind, queryKeys } from "./query-keys";

/** Keeps cached queries in step with the engine without polling. */
export function useEngineEvents() {
  const client = useQueryClient();
  useTauriEvent(events.engineChanged, () => {
    client.invalidateQueries({ queryKey: queryKeys.engine }).catch(() => undefined);
    client.invalidateQueries({ queryKey: queryKeys.storage }).catch(() => undefined);
  });
  useTauriEvent(events.dockerChanged, (event) => {
    client.invalidateQueries({ queryKey: keyForKind[event.kind] }).catch(() => undefined);
  });
  useTauriEvent(events.kubeChanged, () => {
    client.invalidateQueries({ queryKey: queryKeys.kubernetes }).catch(() => undefined);
  });
}
