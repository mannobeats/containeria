import { Channel } from "@tauri-apps/api/core";
import { useEffect, useEffectEvent } from "react";

import { commands } from "./bindings";

/**
 * Subscribes to a Rust stream while the component is mounted and `key` is set. `start` hands the
 * channel to a command that returns a stream id. A new `key` restarts the stream; unmounting or a
 * `null` key cancels it.
 */
export function useStream<T>(
  key: string | null,
  start: (channel: Channel<T>) => Promise<number>,
  onMessage: (message: T) => void,
) {
  const handle = useEffectEvent(onMessage);
  const begin = useEffectEvent(start);
  useEffect(() => {
    if (key === null) {
      return;
    }
    let cancelled = false;
    let id: number | undefined;
    const cancel = () => {
      if (id !== undefined) {
        commands.streamCancel(id).catch(() => undefined);
      }
    };
    begin(new Channel<T>((message) => handle(message)))
      .then((streamId) => {
        id = streamId;
        if (cancelled) {
          cancel();
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      cancel();
    };
  }, [key]);
}
