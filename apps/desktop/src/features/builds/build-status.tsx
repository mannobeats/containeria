import { IconAlertCircle } from "@tabler/icons-react";

import type { BuildStatus } from "@/lib/ipc/bindings";
import { Chip } from "@/ui/chip";

/** Only a failure is coloured; a running build has its progress bar beside it. */
export function BuildStatusLabel({ status }: { status: BuildStatus }) {
  switch (status) {
    case "failed":
      return (
        <Chip tone="bad">
          <IconAlertCircle aria-hidden />
          Failed
        </Chip>
      );
    case "running":
      return <Chip tone="brand">Building</Chip>;
    case "canceled":
      return <Chip>Canceled</Chip>;
    default:
      return <span className="text-ink-3">Completed</span>;
  }
}
