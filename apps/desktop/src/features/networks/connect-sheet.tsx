import { useId, useState } from "react";

import { useContainers } from "@/features/containers/api";
import type { NetworkSummary } from "@/lib/ipc/bindings";
import { Button } from "@/ui/button";
import { Field } from "@/ui/field";
import { inputClass } from "@/ui/input-class";
import { Sheet } from "@/ui/sheet";

import { useConnectNetwork } from "./api";

/** Attaches a container that isn't on the network yet. */
export function ConnectSheet({
  network,
  onClose,
}: {
  network: NetworkSummary;
  onClose: () => void;
}) {
  const ids = useId();
  const { data: containers } = useContainers();
  const connect = useConnectNetwork();
  const attached = new Set(network.containers);
  const candidates = (containers ?? []).filter(
    (container) => container.pod === null && !attached.has(container.name),
  );
  const [chosen, setChosen] = useState("");
  const container = chosen || candidates[0]?.name || "";
  return (
    <Sheet
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={`Connect to ${network.name}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="brand"
            disabled={container === ""}
            loading={connect.isPending}
            onClick={() =>
              connect.mutate(
                {
                  network: network.id,
                  container,
                  networkName: network.name,
                  containerName: container,
                },
                { onSuccess: onClose },
              )
            }
          >
            Connect
          </Button>
        </>
      }
    >
      <Field
        label="Container"
        htmlFor={`${ids}-connect-container`}
        hint={
          candidates.length === 0
            ? "Every container is already on this network."
            : "It can reach the others here by name."
        }
      >
        <select
          id={`${ids}-connect-container`}
          className={inputClass}
          value={container}
          onChange={(event) => setChosen(event.target.value)}
        >
          {candidates.map((candidate) => (
            <option key={candidate.id} value={candidate.name}>
              {candidate.name}
            </option>
          ))}
        </select>
      </Field>
    </Sheet>
  );
}
