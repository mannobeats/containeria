import { formatBytes } from "@/lib/format";
import type { ImageSummary } from "@/lib/ipc/bindings";
import { ConfirmSheet } from "@/ui/confirm-sheet";

import { useRemoveImage } from "./api";
import { BuildSheet } from "./build-sheet";
import type { ImageDialog } from "./image-actions";
import { type ImageStats, imageName } from "./model";
import { PruneSheet } from "./prune-sheet";
import { PullSheet } from "./pull-sheet";
import { PushSheet } from "./push-sheet";
import { ScanSheet } from "./scan-sheet";
import { useImageSheet } from "./sheet-store";
import { TagSheet } from "./tag-sheet";

function DeleteImage({ image, onClose }: { image: ImageSummary; onClose: () => void }) {
  const remove = useRemoveImage();
  const name = image.references[0] ?? imageName(image);
  return (
    <ConfirmSheet
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={`Delete ${name}?`}
      action="Delete image"
      pending={remove.isPending}
      onConfirm={() => remove.mutate({ id: image.id, name }, { onSettled: onClose })}
    >
      {formatBytes(image.sizeBytes)} is freed. You can pull it again later.
    </ConfirmSheet>
  );
}

type ImageDialogsProps = { dialog: ImageDialog | null; stats: ImageStats; onClose: () => void };

/**
 * Every sheet the images page opens: pull, build and clean-up (also from the palette and a drop),
 * tag, push, scan and delete.
 */
export function ImageDialogs({ dialog, stats, onClose }: ImageDialogsProps) {
  const sheet = useImageSheet((state) => state.sheet);
  const setSheet = useImageSheet((state) => state.setSheet);
  return (
    <>
      <PullSheet open={sheet === "pull"} onOpenChange={(open) => setSheet(open ? "pull" : null)} />
      <PruneSheet
        open={sheet === "prune"}
        onOpenChange={(open) => setSheet(open ? "prune" : null)}
        stats={stats}
      />
      <TagSheet
        image={
          dialog?.kind === "tag" ? { id: dialog.image.id, name: imageName(dialog.image) } : null
        }
        onClose={onClose}
      />
      {dialog?.kind === "delete" ? <DeleteImage image={dialog.image} onClose={onClose} /> : null}
      <PushSheet
        reference={dialog?.kind === "push" ? (dialog.image.references[0] ?? null) : null}
        onClose={onClose}
      />
      <ScanSheet
        reference={dialog?.kind === "scan" ? (dialog.image.references[0] ?? null) : null}
        onClose={onClose}
      />
      <BuildSheet />
    </>
  );
}
