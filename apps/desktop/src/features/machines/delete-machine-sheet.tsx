import type { Machine } from "@/lib/ipc/bindings";
import { ConfirmSheet } from "@/ui/confirm-sheet";

import { useDeleteMachine } from "./api";

type DeleteMachineSheetProps = {
  machine: Machine | null;
  onClose: () => void;
  onDeleted?: () => void;
};

export function DeleteMachineSheet({ machine, onClose, onDeleted }: DeleteMachineSheetProps) {
  const remove = useDeleteMachine();
  return (
    <ConfirmSheet
      open={machine !== null}
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={`Delete ${machine?.name ?? "machine"}?`}
      action="Delete machine"
      pending={remove.isPending}
      onConfirm={() => {
        if (machine) {
          remove.mutate(machine.name, {
            ...(onDeleted ? { onSuccess: onDeleted } : {}),
            onSettled: onClose,
          });
        }
      }}
    >
      Its disk, installed packages and everything in its home folder are deleted and can't be
      recovered. Files in your Mac home aren't touched.
    </ConfirmSheet>
  );
}
