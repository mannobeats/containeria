import { plural } from "@/lib/format";
import type { ContainerSummary } from "@/lib/ipc/bindings";
import { ConfirmSheet } from "@/ui/confirm-sheet";

type DeleteSheetProps = {
  containers: ContainerSummary[];
  onCancel: () => void;
  onConfirm: () => void;
};

export function DeleteSheet({ containers, onCancel, onConfirm }: DeleteSheetProps) {
  const what =
    containers.length === 1
      ? (containers[0]?.name ?? "container")
      : plural(containers.length, "container");
  return (
    <ConfirmSheet
      open={containers.length > 0}
      onOpenChange={(open) => (open ? undefined : onCancel())}
      title={`Delete ${what}?`}
      action={containers.length === 1 ? "Delete container" : `Delete ${what}`}
      onConfirm={onConfirm}
    >
      The container and its writable layer are removed. Volumes are kept. This can't be undone.
    </ConfirmSheet>
  );
}
