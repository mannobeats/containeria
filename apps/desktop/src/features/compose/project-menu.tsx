import {
  IconCloudDownload,
  IconDots,
  IconEdit,
  IconFolder,
  IconHammer,
  IconTrash,
} from "@tabler/icons-react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { useState } from "react";
import { toast } from "sonner";

import { type ComposeVerb, commands } from "@/lib/ipc/bindings";
import { errorMessage } from "@/lib/ipc/errors";
import { Button } from "@/ui/button";
import { Checkbox } from "@/ui/checkbox";
import { Menu, type MenuEntry } from "@/ui/menu";
import { Sheet } from "@/ui/sheet";

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

type RemoveSheetProps = { project: string; open: boolean; onOpenChange: (open: boolean) => void };

function RemoveProjectSheet({ project, open, onOpenChange }: RemoveSheetProps) {
  const [volumes, setVolumes] = useState(false);
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={`Remove ${project}?`}
      description="Its containers and networks are deleted. Images and the Compose file stay."
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="danger"
            onClick={() => {
              onOpenChange(false);
              run(
                project,
                volumes ? "downWithVolumes" : "down",
                `Removing ${project}`,
                `${project} was removed`,
              );
            }}
          >
            Remove Project
          </Button>
        </>
      }
    >
      <span className="flex items-center gap-2 text-13 text-ink">
        <Checkbox checked={volumes} onCheckedChange={setVolumes} label="Also delete its volumes" />
        Also delete its volumes, and the data in them
      </span>
    </Sheet>
  );
}

/** The ⋯ menu of a Compose project: its file, rebuild, update and remove. */
export function ProjectMenu({ project }: { project: string }) {
  const [removing, setRemoving] = useState(false);
  const entries: MenuEntry[] = [
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
  ];
  return (
    <>
      <Menu entries={entries} align="end">
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          aria-label={`More for ${project}`}
          className="text-ink-3 hover:text-ink"
        >
          <IconDots />
        </Button>
      </Menu>
      <RemoveProjectSheet project={project} open={removing} onOpenChange={setRemoving} />
    </>
  );
}
