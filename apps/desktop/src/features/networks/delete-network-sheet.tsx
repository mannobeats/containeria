import type { NetworkSummary } from "@/lib/ipc/bindings";
import { ConfirmSheet } from "@/ui/confirm-sheet";

import { useRemoveNetwork } from "./api";

export function DeleteNetworkSheet({
  network,
  onClose,
}: {
  network: NetworkSummary | null;
  onClose: () => void;
}) {
  const remove = useRemoveNetwork();
  return (
    <ConfirmSheet
      open={network !== null}
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={`Delete ${network?.name ?? "network"}?`}
      action="Delete network"
      pending={remove.isPending}
      onConfirm={() =>
        network && remove.mutate({ id: network.id, name: network.name }, { onSuccess: onClose })
      }
    >
      No container uses it.
    </ConfirmSheet>
  );
}
