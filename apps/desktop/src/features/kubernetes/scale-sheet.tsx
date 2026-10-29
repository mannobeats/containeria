import { useState } from "react";

import type { DeploymentSummary } from "@/lib/ipc/bindings";
import { Button } from "@/ui/button";
import { Sheet } from "@/ui/sheet";

import { useScaleDeployment } from "./api";

type ScaleSheetProps = { deployment: DeploymentSummary; onClose: () => void };

export function ScaleSheet({ deployment, onClose }: ScaleSheetProps) {
  const [replicas, setReplicas] = useState(deployment.desired);
  const scale = useScaleDeployment(deployment);
  return (
    <Sheet
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={`Scale ${deployment.name}`}
      description={`${deployment.ready} of ${deployment.desired} replicas are ready now.`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="brand"
            loading={scale.isPending}
            onClick={() => scale.mutate(replicas, { onSuccess: onClose })}
          >
            Scale
          </Button>
        </>
      }
    >
      <label className="flex items-center gap-3 text-13 text-ink-2">
        Replicas
        <input
          type="range"
          min={0}
          max={Math.max(10, deployment.desired)}
          value={replicas}
          onChange={(event) => setReplicas(Number(event.target.value))}
          className="flex-1 accent-brand"
        />
        <b className="w-6 text-right font-semibold text-ink tabular">{replicas}</b>
      </label>
    </Sheet>
  );
}
