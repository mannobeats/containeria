import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useEffect, useEffectEvent, useState } from "react";

/**
 * Hands the first file in a drop that `accepts` takes to `onDrop`. Says whether such a file is
 * being dragged over the window, for the drop target.
 */
export function useFileDrop(accepts: (path: string) => boolean, onDrop: (path: string) => void) {
  const [dragging, setDragging] = useState(false);
  const takes = useEffectEvent(accepts);
  const dropped = useEffectEvent(onDrop);
  useEffect(() => {
    let stop: (() => void) | undefined;
    let active = true;
    getCurrentWebview()
      .onDragDropEvent(({ payload }) => {
        if (payload.type === "enter") {
          setDragging(payload.paths.some(takes));
          return;
        }
        if (payload.type === "over") {
          return;
        }
        setDragging(false);
        const file = payload.type === "drop" ? payload.paths.find(takes) : undefined;
        if (file) {
          dropped(file);
        }
      })
      .then((unlisten) => {
        stop = unlisten;
        if (!active) {
          unlisten();
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
      stop?.();
    };
  }, []);
  return dragging;
}
