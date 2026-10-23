import { IconHammer } from "@tabler/icons-react";
import { useNavigate } from "@tanstack/react-router";

import { useFileDrop } from "@/lib/use-file-drop";
import { DropOverlay } from "@/ui/drop-overlay";

import { isDockerfile } from "./build-model";
import { useImageSheet } from "./sheet-store";

/** Opens the Build sheet for a Dockerfile dropped anywhere on the window, in its own folder. */
export function DockerfileDropTarget() {
  const navigate = useNavigate();
  const dragging = useFileDrop(isDockerfile, (path) => {
    const slash = path.lastIndexOf("/");
    navigate({ to: "/images" }).catch(() => undefined);
    useImageSheet
      .getState()
      .openBuild({ context: path.slice(0, slash), dockerfile: path.slice(slash + 1) });
  });
  return dragging ? (
    <DropOverlay icon={<IconHammer aria-hidden />}>Drop to build the Dockerfile</DropOverlay>
  ) : null;
}
