import { useEffect, useRef, useState } from "react";

import { commands, type PodSummary } from "@/lib/ipc/bindings";
import { useStream } from "@/lib/ipc/use-stream";

/** Older lines drop off past this, so a chatty pod can't grow the view without bound. */
const KEEP = 5000;

/** Follows the pod's log live, newest at the bottom, sticking to the end unless scrolled up. */
export function PodLogs({ pod, container }: { pod: PodSummary; container: string | null }) {
  const [lines, setLines] = useState<string[]>([]);
  const view = useRef<HTMLPreElement>(null);
  const key = `${pod.namespace}/${pod.name}/${container ?? ""}`;
  useStream<string>(
    key,
    (channel) => {
      setLines([]);
      return commands.kubernetesLogs(pod.namespace, pod.name, container, channel);
    },
    (line) => setLines((current) => [...current.slice(-(KEEP - 1)), line]),
  );
  useEffect(() => {
    const element = view.current;
    if (element && element.scrollHeight - element.scrollTop - element.clientHeight < 80) {
      element.scrollTop = element.scrollHeight;
    }
  });
  return (
    <pre
      ref={view}
      role="log"
      aria-label={`Logs of ${pod.name}`}
      className="selectable m-0 h-full overflow-auto bg-[light-dark(oklch(0.985_0_0),oklch(0.16_0.005_255))] px-5 py-3 font-mono text-mono-12 leading-[1.6] whitespace-pre-wrap text-ink-2"
    >
      {lines.length === 0 ? <span className="text-ink-4">No output yet.</span> : lines.join("\n")}
    </pre>
  );
}
