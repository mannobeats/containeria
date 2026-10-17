import {
  IconCloudDownload,
  IconEdit,
  IconFolder,
  IconHammer,
  IconTrash,
} from "@tabler/icons-react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";

import { type ComposeVerb, commands } from "@/lib/ipc/bindings";
import { errorMessage } from "@/lib/ipc/errors";
import type { MenuEntry } from "@/ui/menu";

import { RemoveProjectSheet } from "./remove-project-sheet";
import { editProject, startRun } from "./store";

function run(project: string, verb: ComposeVerb, title: string, done: string) {
  startRun({ title, done, start: (channel) => commands.composeAct(project, verb, channel) });
}

function reveal(project: string) {
  commands
    .composeProjectFile(project)
    .then((document) => revealItemInDir(document.path))
    .catch((error: unknown) =>
      toast.error(`Couldn't find ${project}'s Compose file`, { description: errorMessage(error) }),
    );
}

/**
 * A Compose project's file, rebuild, update and remove entries, for its ⋯ button and its
 * right-click menu. Render `sheet` once: it asks before removing.
 */
export function useProjectMenu(project: string): { entries: MenuEntry[]; sheet: ReactNode } {
  const [removing, setRemoving] = useState(false);
  return {
    entries: [
      { label: "Edit Compose File…", icon: <IconEdit />, onSelect: () => editProject(project) },
      { label: "Show in Finder", icon: <IconFolder />, onSelect: () => reveal(project) },
      { kind: "separator" },
      {
        label: "Rebuild and Restart",
        icon: <IconHammer />,
        onSelect: () => run(project, "rebuild", `Rebuilding ${project}`, `${project} was rebuilt`),
      },
      {
        label: "Pull Latest Images",
        icon: <IconCloudDownload />,
        onSelect: () => run(project, "pull", `Updating ${project}`, `${project} is up to date`),
      },
      { kind: "separator" },
      {
        label: "Remove Project…",
        icon: <IconTrash />,
        danger: true,
        onSelect: () => setRemoving(true),
      },
    ],
    sheet: (
      <RemoveProjectSheet
        project={project}
        open={removing}
        onOpenChange={setRemoving}
        onRemove={(volumes) =>
          run(
            project,
            volumes ? "downWithVolumes" : "down",
            `Removing ${project}`,
            `${project} was removed`,
          )
        }
      />
    ),
  };
}
