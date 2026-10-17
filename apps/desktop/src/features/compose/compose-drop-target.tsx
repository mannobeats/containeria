import { IconStack2 } from "@tabler/icons-react";

import { useFileDrop } from "@/lib/use-file-drop";
import { DropOverlay } from "@/ui/drop-overlay";

import { isComposeFile } from "./model";
import { openComposeFile } from "./store";

/** Opens a Compose file dropped anywhere on the window in the editor. */
export function ComposeDropTarget() {
  const dragging = useFileDrop(isComposeFile, openComposeFile);
  return dragging ? (
    <DropOverlay icon={<IconStack2 aria-hidden />}>Drop to open the Compose file</DropOverlay>
  ) : null;
}
