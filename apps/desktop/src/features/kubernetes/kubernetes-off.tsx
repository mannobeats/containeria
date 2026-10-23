import { IconPower } from "@tabler/icons-react";

import { useBootLog } from "@/features/engine/api";
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

export function KubernetesStarting() {
  const line = useBootLog((state) => state.lines.at(-1));
  return (
    <EmptyState art={<Tile icon="kube" size="xl" />} title="Starting Kubernetes" className="pt-24">
      <p className="m-0">
        k3s is starting inside the engine. The first start downloads its images.
      </p>
      <Progress label="Kubernetes progress" className="mx-auto mt-2 w-60" />
      <p className="m-0 mt-0.5 h-5 truncate text-12 text-ink-3">{line?.message ?? ""}</p>
    </EmptyState>
  );
}
