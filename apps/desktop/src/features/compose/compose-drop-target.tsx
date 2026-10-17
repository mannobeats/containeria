import { IconStack2 } from "@tabler/icons-react";

import { useFileDrop } from "@/lib/use-file-drop";

import { isComposeFile } from "./model";
import { openComposeFile } from "./store";

/** Opens a Compose file dropped anywhere on the window, and covers the window while one is dragged. */
export function ComposeDropTarget() {
  const dragging = useFileDrop(isComposeFile, openComposeFile);
  if (!dragging) {
    return null;
  }
  return (
    <div className="pointer-events-none fixed inset-3 z-50 flex flex-col items-center justify-center gap-2.5 rounded-lg border-2 border-dashed border-brand bg-brand-soft text-brand-ink animate-fade">
      <IconStack2 className="size-7" aria-hidden />
      <b>Drop to open the Compose file</b>
    </div>
  );
}
