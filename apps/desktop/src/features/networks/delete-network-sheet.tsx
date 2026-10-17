import { plural } from "@/lib/format";
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
  const attached = network?.containers.length ?? 0;
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
      {attached > 0
        ? `${plural(attached, "container")} still use it; disconnect them first. They lose the names they have on this network.`
        : "No container uses it."}
    </ConfirmSheet>
  );
}
