import { plural } from "@/lib/format";
import { type Cluster, commands } from "@/lib/ipc/bindings";
import { ConfirmSheet } from "@/ui/confirm-sheet";

import { useKubeAction, useResetCluster, useSetKubernetes } from "./api";
import { ApplySheet } from "./apply-sheet";
import { ConfigSheet } from "./config-sheet";
import { ForwardSheet } from "./forward-sheet";
import type { KubeSheet } from "./kube-sheet";
import { ScaleSheet } from "./scale-sheet";

type Target = { namespace: string; name: string };

function DeleteSheet({
  what,
  target,
  onClose,
}: {
  what: "pod" | "deployment";
  target: Target;
  onClose: () => void;
}) {
  const remove = useKubeAction(
    () =>
      what === "pod"
        ? commands.kubernetesDeletePod(target.namespace, target.name)
        : commands.kubernetesDeleteDeployment(target.namespace, target.name),
    () => `Deleted ${target.name}`,
  );
  return (
    <ConfirmSheet
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={`Delete ${target.name}?`}
      action={what === "pod" ? "Delete pod" : "Delete deployment"}
      pending={remove.isPending}
      onConfirm={() => remove.mutate(undefined, { onSuccess: onClose })}
    >
      {what === "pod"
        ? "Its controller schedules a replacement right away."
        : "Its pods stop and aren't replaced. Services that point at it stop answering."}
    </ConfirmSheet>
  );
}

function ClusterSheet({
  kind,
  cluster,
  onClose,
}: {
  kind: "turnOff" | "reset";
  cluster: Cluster;
  onClose: () => void;
}) {
  const turnOff = useSetKubernetes();
  const reset = useResetCluster();
  const pods = plural(cluster.pods.length, "pod");
  if (kind === "turnOff") {
    return (
      <ConfirmSheet
        open
        onOpenChange={(open) => (open ? undefined : onClose())}
        title="Turn off Kubernetes?"
        action="Turn off"
        pending={turnOff.isPending}
        onConfirm={() => turnOff.mutate(false, { onSuccess: onClose })}
      >
        {pods} stop and their memory goes back to the engine. Deployments, services and volumes are
        kept.
      </ConfirmSheet>
    );
  }
  return (
    <ConfirmSheet
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Reset the Kubernetes cluster?"
      action="Reset cluster"
      pending={reset.isPending}
      onConfirm={() => reset.mutate(undefined, { onSuccess: onClose })}
    >
      Every namespace, deployment, service and volume claim is deleted ({pods} across{" "}
      {plural(cluster.namespaces.length, "namespace")}). Docker containers and images aren't
      touched.
    </ConfirmSheet>
  );
}

export function KubeSheets({
  sheet,
  cluster,
  onClose,
}: {
  sheet: KubeSheet | null;
  cluster: Cluster;
  onClose: () => void;
}) {
  switch (sheet?.kind) {
    case "apply":
      return (
        <ApplySheet
          onClose={onClose}
          namespaces={cluster.namespaces}
          {...(sheet.manifest ? { manifest: sheet.manifest } : {})}
        />
      );
    case "scale":
      return <ScaleSheet deployment={sheet.deployment} onClose={onClose} />;
    case "forward":
      return <ForwardSheet pod={sheet.pod} onClose={onClose} />;
    case "config":
      return <ConfigSheet config={sheet.config} onClose={onClose} />;
    case "deletePod":
      return <DeleteSheet what="pod" target={sheet.pod} onClose={onClose} />;
    case "deleteDeployment":
      return <DeleteSheet what="deployment" target={sheet.deployment} onClose={onClose} />;
    case "turnOff":
    case "reset":
      return <ClusterSheet kind={sheet.kind} cluster={cluster} onClose={onClose} />;
    default:
      return null;
  }
}
