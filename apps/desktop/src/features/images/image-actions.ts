import { save } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";

import { useRunSheet } from "@/features/containers/run/api";
import { copyText } from "@/lib/clipboard";
import { commands, type ImageSummary } from "@/lib/ipc/bindings";
import { errorMessage } from "@/lib/ipc/errors";
import type { MenuEntry } from "@/ui/menu";

import { shortId } from "./model";

/** The sheets an image's menu opens. */
export type ImageDialog = { kind: "tag" | "delete" | "push" | "scan"; image: ImageSummary };

/** `ghcr.io/acme/api:1.2` → `api-1.2.tar`. */
export function archiveName(reference: string): string {
  const name = reference.split("/").at(-1) ?? reference;
  return `${name.replace(/[:@]/g, "-")}.tar`;
}

/** Saves the image as a `.tar` archive, asking where with the macOS save panel. */
function exportImage(reference: string) {
  save({ title: `Export ${reference}`, defaultPath: archiveName(reference) })
    .then((path) => {
      if (!path) {
        return;
      }
      const saving = toast.loading(`Exporting ${reference}…`);
      commands
        .imageExport(reference, path)
        .then(() =>
          toast.success(`Saved ${path.split("/").at(-1)}`, {
            id: saving,
            action: { label: "Show in Finder", onClick: () => revealItemInDir(path) },
          }),
        )
        .catch((error: unknown) =>
          toast.error("The export failed", { id: saving, description: errorMessage(error) }),
        );
    })
    .catch(() => undefined);
}

type Handlers = { open: () => void; onDialog: (dialog: ImageDialog) => void };

/** The same menu on the row's ⋯ button, on right-click and on the image's page. */
export function imageMenu(image: ImageSummary, { open, onDialog }: Handlers): MenuEntry[] {
  const reference = image.references[0];
  const inUse = image.containers > 0;
  return [
    { label: "Open", onSelect: open },
    {
      label: "Run…",
      disabled: !reference,
      onSelect: () => useRunSheet.getState().show(reference),
    },
    {
      label: "Scan for Vulnerabilities",
      disabled: !reference,
      onSelect: () => onDialog({ kind: "scan", image }),
    },
    { kind: "separator" },
    {
      label: "Copy Reference",
      disabled: !reference,
      onSelect: () => copyText("Reference", reference ?? ""),
    },
    { label: "Copy ID", onSelect: () => copyText("ID", shortId(image.id)) },
    { kind: "separator" },
    { label: "Tag…", disabled: image.dangling, onSelect: () => onDialog({ kind: "tag", image }) },
    { label: "Push…", disabled: !reference, onSelect: () => onDialog({ kind: "push", image }) },
    {
      label: "Export…",
      disabled: !reference,
      onSelect: () => (reference ? exportImage(reference) : undefined),
    },
    { kind: "separator" },
    {
      label: inUse ? "Delete (in use)" : "Delete Image…",
      danger: true,
      disabled: inUse,
      onSelect: () => onDialog({ kind: "delete", image }),
    },
  ];
}
