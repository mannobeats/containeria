import { useState } from "react";

import type { PodSummary } from "@/lib/ipc/bindings";
import { LogView } from "@/ui/log-view";
import { Select } from "@/ui/select";

import { usePodLog } from "./api";
import { podContainer } from "./model";

/** Follows the pod's log live, one container at a time when it has several. */
export function PodLogs({ pod }: { pod: PodSummary }) {
  const [picked, setPicked] = useState<string | null>(null);
  const container = podContainer(pod, picked);
  const lines = usePodLog(pod, container);
  // A new stream starts at its end, not wherever the reader left the previous one.
  const log = (
    <LogView
      key={`${pod.namespace}/${pod.name}/${container ?? ""}`}
      label={`Logs of ${pod.name}`}
      lines={lines}
    />
  );
  if (container === null) {
    return log;
  }
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-11 shrink-0 items-center border-b-[0.5px] border-line pr-3 pl-5">
        <Select
          label="Container"
          value={container}
          options={pod.containers.map((name) => ({ value: name, label: name }))}
          onChange={setPicked}
          className="w-48"
        />
      </div>
      <div className="min-h-0 flex-1">{log}</div>
    </div>
  );
}
