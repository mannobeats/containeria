import { IconDots } from "@tabler/icons-react";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { copyText } from "@/lib/clipboard";
import type { ContainerDetails } from "@/lib/ipc/bindings";
import { Button } from "@/ui/button";
import { ConfirmSheet } from "@/ui/confirm-sheet";
import { Menu, type MenuEntry } from "@/ui/menu";
import { PromptSheet } from "@/ui/prompt-sheet";

import { useContainerAction, useRecreate } from "../api";
import { useCommit, useExport, useRename } from "./api";

type Dialog = "rename" | "commit" | "delete" | null;

const NAME = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;
const REFERENCE = /^[a-z0-9]+(?:[._/-][a-z0-9]+)*(?::[\w][\w.-]{0,127})?$/;

/** The rarer actions, each behind a sheet when it changes or removes something. */
export function DetailMenu({ details }: { details: ContainerDetails }) {
  const [dialog, setDialog] = useState<Dialog>(null);
  const navigate = useNavigate();
  const action = useContainerAction();
  const recreate = useRecreate();
  const recreateWith = (pull: boolean) =>
    recreate.mutate(
      { id: details.id, name: details.name, pull },
      {
        onSuccess: (id) =>
          navigate({ to: "/containers/$id", params: { id } }).catch(() => undefined),
      },
    );
  const rename = useRename(details.id);
  const commit = useCommit(details.id);
  const exportFiles = useExport(details.id, details.name);
  const running = details.state === "running";
  const target = [{ id: details.id, name: details.name }];
  const entries: MenuEntry[] = [
    { label: "Copy ID", onSelect: () => copyText("ID", details.id.slice(0, 12)) },
    {
      label: "Copy docker exec Command",
      onSelect: () => copyText("Command", `docker exec -it ${details.name} sh`),
    },
    { kind: "separator" },
    details.state === "paused"
      ? { label: "Resume", onSelect: () => action.mutate({ containers: target, action: "resume" }) }
      : {
          label: "Pause",
          disabled: !running,
          onSelect: () => action.mutate({ containers: target, action: "pause" }),
        },
    {
      label: "Kill",
      disabled: !running,
      onSelect: () => action.mutate({ containers: target, action: "kill" }),
    },
    { kind: "separator" },
    { label: "Recreate", onSelect: () => recreateWith(false) },
    { label: "Recreate with Latest Image", onSelect: () => recreateWith(true) },
    { kind: "separator" },
    { label: "Rename…", onSelect: () => setDialog("rename") },
    { label: "Commit to Image…", onSelect: () => setDialog("commit") },
    { label: "Export Filesystem…", onSelect: () => exportFiles.mutate() },
    { kind: "separator" },
    { label: "Delete…", danger: true, onSelect: () => setDialog("delete") },
  ];
  const close = (open: boolean) => (open ? undefined : setDialog(null));
  return (
    <>
      <Menu entries={entries} align="end">
        <Button iconOnly aria-label={`More for ${details.name}`}>
          <IconDots />
        </Button>
      </Menu>
      <PromptSheet
        key={`rename-${dialog}`}
        open={dialog === "rename"}
        onOpenChange={close}
        title={`Rename ${details.name}`}
        label="Name"
        initial={details.name}
        action="Rename"
        validate={(value) =>
          NAME.test(value) ? undefined : "Use letters, numbers, dots, dashes and underscores."
        }
        onSubmit={(name) => rename.mutate(name)}
      />
      <PromptSheet
        key={`commit-${dialog}`}
        open={dialog === "commit"}
        onOpenChange={close}
        title="Commit to image"
        label="Image name and tag"
        initial={`${details.name}:snapshot`}
        hint="Saves the container's files as a new image. Volumes aren't included."
        action="Commit"
        validate={(value) =>
          REFERENCE.test(value) ? undefined : "Use a lowercase name like my-app:snapshot."
        }
        onSubmit={(reference) => commit.mutate(reference)}
      />
      <ConfirmSheet
        open={dialog === "delete"}
        onOpenChange={close}
        title={`Delete ${details.name}?`}
        action="Delete container"
        onConfirm={() => {
          setDialog(null);
          action.mutate({ containers: target, action: "remove" });
          navigate({ to: "/containers" }).catch(() => undefined);
        }}
      >
        The container and its writable layer are removed. Volumes are kept. This can't be undone.
      </ConfirmSheet>
    </>
  );
}
