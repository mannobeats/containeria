import type { EventCallback, UnlistenFn } from "@tauri-apps/api/event";
import { useEffect, useEffectEvent } from "react";

type Listenable<T> = { listen: (handler: EventCallback<T>) => Promise<UnlistenFn> };

/** Tauri resolves its unlisten function asynchronously; this hands back a synchronous one. */
function subscribe<T>(event: Listenable<T>, handler: (payload: T) => void): () => void {
  let unlisten: UnlistenFn | undefined;
  let active = true;
  event
    .listen(({ payload }) => handler(payload))
    .then((stop) => {
      unlisten = stop;
      if (!active) {
        stop();
      }
    })
    .catch(() => undefined);
  return () => {
    active = false;
    unlisten?.();
  };
}

/** Listens to a typed Tauri event while the component is mounted. */
export function useTauriEvent<T>(event: Listenable<T>, handler: (payload: T) => void) {
  const handle = useEffectEvent(handler);
  useEffect(() => subscribe(event, (payload) => handle(payload)), [event]);
}
