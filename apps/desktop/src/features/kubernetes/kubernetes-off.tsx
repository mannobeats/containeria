import { IconPower } from "@tabler/icons-react";

import { Button } from "@/ui/button";
import { EmptyState } from "@/ui/empty-state";
import { Progress } from "@/ui/progress";
import { Tile } from "@/ui/tile";

import { useSetKubernetes } from "./api";

export function KubernetesOff() {
  const turnOn = useSetKubernetes();
  if (turnOn.isPending) {
    return <KubernetesStarting />;
  }
  return (
    <EmptyState
      art={<Tile icon="kube" size="xl" />}
      title="Kubernetes is off"
      className="pt-24"
      actions={
        <Button variant="brand" size="lg" onClick={() => turnOn.mutate(true)}>
          <IconPower />
          Turn on Kubernetes
        </Button>
      }
    >
      Turn it on to run a single-node k3s cluster inside the engine. It shares images with Docker,
      so local builds deploy without a registry.
    </EmptyState>
  );
}

/** `canTurnOff` offers a way out when k3s never comes up: the cluster header isn't shown yet. */
export function KubernetesStarting({ canTurnOff = false }: { canTurnOff?: boolean }) {
  const turnOff = useSetKubernetes();
  return (
    <EmptyState
      art={<Tile icon="kube" size="xl" />}
      title="Starting Kubernetes"
      className="pt-24"
      actions={
        canTurnOff ? (
          <Button loading={turnOff.isPending} onClick={() => turnOff.mutate(false)}>
            Turn off Kubernetes
          </Button>
        ) : null
      }
    >
      <p className="m-0">
        k3s is starting inside the engine. The first start downloads it and its images.
      </p>
      <Progress label="Kubernetes progress" className="mx-auto mt-2 w-60" />
    </EmptyState>
  );
}
