import { IconAlertCircle, IconAlertTriangle } from "@tabler/icons-react";

import type { ContainerSummary } from "@/lib/ipc/bindings";

import { isCrashed } from "./model";

/** Docker's status line, with the parts that need attention marked. */
export function ContainerStatus({ container }: { container: ContainerSummary }) {
  if (container.status.includes("(unhealthy)")) {
    return (
      <span className="inline-flex items-center gap-1 text-warn-ink">
        <IconAlertTriangle className="size-3.5" aria-hidden />
        Unhealthy
      </span>
    );
  }
  if (isCrashed(container)) {
    return (
      <span className="inline-flex min-w-0 items-center gap-1 text-bad-ink">
        <IconAlertCircle className="size-3.5" aria-hidden />
        <span className="truncate">{container.status || "Dead"}</span>
      </span>
    );
  }
  return (
    <span className="truncate text-ink-3">{container.status.replace(/ \(healthy\)$/, "")}</span>
  );
}
