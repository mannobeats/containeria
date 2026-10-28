import clsx from "clsx";

import { formatRelative } from "@/lib/format";
import type { PodSummary } from "@/lib/ipc/bindings";
import { EmptyState } from "@/ui/empty-state";
import { Skeleton } from "@/ui/progress";

import { useKubeEvents } from "./api";

/** What happened to the pod, newest first, warnings in red. */
export function PodEvents({ pod }: { pod: PodSummary }) {
  const { data: events } = useKubeEvents(pod.namespace, pod.name);
  if (!events) {
    return <Skeleton className="m-5 w-72" />;
  }
  if (events.length === 0) {
    return <EmptyState title="No events">Kubernetes keeps events for about an hour.</EmptyState>;
  }
  return (
    <ol className="m-0 flex list-none flex-col gap-3 px-5 py-4">
      {events.map((event) => (
        <li key={`${event.reason}-${event.lastSeen}-${event.message}`} className="flex gap-3">
          <span
            aria-hidden
            className={clsx(
              "mt-1.5 size-2 shrink-0 rounded-full",
              event.warning ? "bg-bad" : "bg-ink-4",
            )}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <b
                className={clsx(
                  "text-13 font-semibold",
                  event.warning ? "text-bad-ink" : "text-ink",
                )}
              >
                {event.warning ? <span className="sr-only">Warning: </span> : null}
                {event.reason}
              </b>
              {event.count > 1 ? <span className="text-12 text-ink-3">×{event.count}</span> : null}
              <span className="ml-auto text-12 text-ink-3">{formatRelative(event.lastSeen)}</span>
            </div>
            <p className="m-0 text-13 text-ink-2">{event.message}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
