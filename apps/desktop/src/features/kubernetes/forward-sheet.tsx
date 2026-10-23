import { useId, useState } from "react";

import type { PodSummary } from "@/lib/ipc/bindings";
import { Button } from "@/ui/button";
import { Field, Input } from "@/ui/field";
import { Sheet } from "@/ui/sheet";

import { useStartForward } from "./forwards";

const isPort = (value: number) => Number.isInteger(value) && value > 0 && value < 65_536;

export function ForwardSheet({ pod, onClose }: { pod: PodSummary; onClose: () => void }) {
  const [localPort, setLocalPort] = useState("8080");
  const [podPort, setPodPort] = useState("8080");
  const start = useStartForward(pod);
  const id = useId();
  const ports = { localPort: Number(localPort), podPort: Number(podPort) };
  const valid = isPort(ports.localPort) && isPort(ports.podPort);
  return (
    <Sheet
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={`Port forward ${pod.name}`}
      description="LoadBalancer services are already on localhost. Forward a port only for pods without one."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="brand"
            disabled={!valid}
            loading={start.isPending}
            onClick={() => start.mutate(ports, { onSuccess: onClose })}
          >
            Forward
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Mac port" htmlFor={`${id}-local`}>
          <Input
            id={`${id}-local`}
            inputMode="numeric"
            className="font-mono"
            value={localPort}
            onChange={(event) => setLocalPort(event.target.value)}
          />
        </Field>
        <Field label="Pod port" htmlFor={`${id}-pod`}>
          <Input
            id={`${id}-pod`}
            inputMode="numeric"
            className="font-mono"
            value={podPort}
            onChange={(event) => setPodPort(event.target.value)}
          />
        </Field>
      </div>
    </Sheet>
  );
}
