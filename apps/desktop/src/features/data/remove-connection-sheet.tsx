import type { Connection } from "@/lib/ipc/bindings";
import { ConfirmSheet } from "@/ui/confirm-sheet";

import { useRemoveConnection } from "./api";

/** Asks before removing a saved connection; `removing` is the one asked about, if any. */
export function RemoveConnectionSheet({
  removing,
  onDone,
}: {
  removing: Connection | null;
  onDone: () => void;
}) {
  const remove = useRemoveConnection();
  return (
    <ConfirmSheet
      open={removing !== null}
      onOpenChange={(open) => (open ? undefined : onDone())}
      title={`Remove ${removing?.name ?? "connection"}?`}
      action="Remove connection"
      onConfirm={() => {
        if (removing) {
          remove.mutate(removing.id);
        }
        onDone();
      }}
    >
      The saved connection and its Keychain password are removed. The database itself is not
      touched.
    </ConfirmSheet>
  );
}
