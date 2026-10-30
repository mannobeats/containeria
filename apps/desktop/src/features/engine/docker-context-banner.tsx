import { IconAlertTriangle } from "@tabler/icons-react";
import clsx from "clsx";

import type { ForeignContext } from "@/lib/ipc/bindings";
import { errorMessage } from "@/lib/ipc/errors";
import { Banner } from "@/ui/banner";
import { Button } from "@/ui/button";

import { useEngineStatus, useUseContaineriaContext } from "./api";

function reach({ endpoint, answers }: ForeignContext): string {
  if (endpoint === null) {
    return "No context has that name, so docker commands fail.";
  }
  if (answers === null) {
    return "Containeria can't check whether it answers.";
  }
  return answers
    ? "Another engine answers there."
    : "Nothing answers there, so docker commands fail.";
}

/**
 * Says when the Docker CLI's current context has moved off Containeria, beside the engine's status
 * in the window and the menu bar, and offers to move it back.
 */
export function DockerContextBanner({ className }: { className?: string }) {
  const { data: status } = useEngineStatus();
  const use = useUseContaineriaContext();
  const context = status?.dockerContext;
  if (!context) {
    return null;
  }
  return (
    <Banner
      tone="warn"
      icon={<IconAlertTriangle className="mt-px size-4 shrink-0" aria-hidden />}
      className={clsx("items-start", className)}
    >
      <p className="m-0">
        <b>
          Docker commands go to <code className="font-mono text-mono-12">{context.name}</code>
        </b>
        , not Containeria.
      </p>
      {context.endpoint ? (
        <p className="m-0 mt-1 font-mono text-mono-12 break-all">{context.endpoint}</p>
      ) : null}
      <p className="m-0 mt-1">{reach(context)}</p>
      {use.isError ? <p className="m-0 mt-1 text-bad-ink">{errorMessage(use.error)}</p> : null}
      <Button size="sm" className="mt-2" loading={use.isPending} onClick={() => use.mutate()}>
        Use Containeria
      </Button>
    </Banner>
  );
}
