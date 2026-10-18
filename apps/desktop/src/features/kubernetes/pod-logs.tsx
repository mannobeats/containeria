import { useState } from "react";

import { commands, type PodSummary } from "@/lib/ipc/bindings";
import { useStream } from "@/lib/ipc/use-stream";
import { LogView } from "@/ui/log-view";

/** Older lines drop off past this, so a chatty pod can't grow the view without bound. */
const KEEP = 5000;

/** Follows the pod's log live. */
export function PodLogs({ pod, container }: { pod: PodSummary; container: string | null }) {
  const [lines, setLines] = useState<string[]>([]);
  const key = `${pod.namespace}/${pod.name}/${container ?? ""}`;
  useStream<string>(
    key,
    (channel) => {
      setLines([]);
      return commands.kubernetesLogs(pod.namespace, pod.name, container, channel);
    },
    (line) => setLines((current) => [...current.slice(-(KEEP - 1)), line]),
  );
  return <LogView label={`Logs of ${pod.name}`} lines={lines} />;
}
