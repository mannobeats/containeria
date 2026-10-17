import { formatBytes } from "@/lib/format";
import type { VolumeSummary } from "@/lib/ipc/bindings";
import { ConfirmSheet } from "@/ui/confirm-sheet";

import { useCloneVolume, useCreateVolume, usePruneVolumes, useRemoveVolume } from "./api";
import { volumeName, volumeStats } from "./model";
import { NameSheet } from "./name-sheet";

export type VolumeDialog =
  | { kind: "new" }
  | { kind: "prune" }
  | { kind: "clone"; volume: VolumeSummary }
  | { kind: "delete"; volume: VolumeSummary };

type VolumeDialogsProps = {
  dialog: VolumeDialog | null;
  volumes: VolumeSummary[];
  onClose: () => void;
};

function DeleteVolume({ volume, onClose }: { volume: VolumeSummary; onClose: () => void }) {
  const remove = useRemoveVolume();
  const users = volume.usedBy.map((user) => user.container).join(", ");
  const size =
    volume.sizeBytes === null ? "Its files" : `All ${formatBytes(volume.sizeBytes)} of files`;
  return (
    <ConfirmSheet
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={`Delete ${volumeName(volume)}?`}
      action="Delete volume"
      pending={remove.isPending}
      onConfirm={() => remove.mutate(volume.name, { onSuccess: onClose })}
    >
      {users ? `${users} still mounts it; stop those containers first. ` : ""}
      {size} are deleted and can't be recovered. Back it up first if you might need it.
    </ConfirmSheet>
  );
}

function PruneVolumes({ volumes, onClose }: { volumes: VolumeSummary[]; onClose: () => void }) {
  const prune = usePruneVolumes();
  const stats = volumeStats(volumes);
  return (
    <ConfirmSheet
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={`Delete ${stats.unattached} unattached ${stats.unattached === 1 ? "volume" : "volumes"}?`}
      action="Delete volumes"
      pending={prune.isPending}
      onConfirm={() => prune.mutate(undefined, { onSuccess: onClose })}
    >
      No container mounts them. Their {formatBytes(stats.unattachedBytes)} of files are deleted and
      can't be recovered.
    </ConfirmSheet>
  );
}

/** The sheets the volume list opens: new, clone, delete and clean up. */
export function VolumeDialogs({ dialog, volumes, onClose }: VolumeDialogsProps) {
  const create = useCreateVolume();
  const clone = useCloneVolume();
  const taken = volumes.map((volume) => volume.name);
  switch (dialog?.kind) {
    case "new":
      return (
        <NameSheet
          open
          title="New volume"
          action="Create volume"
          hint="Keeps data when containers are recreated."
          taken={taken}
          pending={create.isPending}
          onClose={onClose}
          onSubmit={(name) => create.mutate(name, { onSuccess: onClose })}
        />
      );
    case "clone":
      return (
        <NameSheet
          open
          title={`Clone ${volumeName(dialog.volume)}`}
          action="Clone volume"
          hint="Copies every file. The original stays attached."
          initial={`${dialog.volume.name}_copy`}
          taken={taken}
          pending={clone.isPending}
          onClose={onClose}
          onSubmit={(target) =>
            clone.mutate({ source: dialog.volume.name, target }, { onSuccess: onClose })
          }
        />
      );
    case "delete":
      return <DeleteVolume volume={dialog.volume} onClose={onClose} />;
    case "prune":
      return <PruneVolumes volumes={volumes} onClose={onClose} />;
    default:
      return null;
  }
}
