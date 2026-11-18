import { IconPlayerPlay } from "@tabler/icons-react";

import { openSettings } from "@/features/settings/api";
import type { EnginePhase } from "@/lib/ipc/bindings";
import { AppMark } from "@/ui/app-mark";
import { Button } from "@/ui/button";
import { EmptyState } from "@/ui/empty-state";
import { Progress } from "@/ui/progress";

import { useEngineControl, useEngineStatus } from "./api";

type Idle = "notCreated" | "stopped" | "broken";

const IDLE: Record<Idle, { title: string; body: string; action: string }> = {
  notCreated: {
    title: "Set up the engine",
    body: "Containeria runs Docker in a small Linux VM of its own. It starts in about a second.",
    action: "Create engine",
  },
  stopped: {
    title: "The engine is stopped",
    body: "Containers, Kubernetes and Linux machines run inside it. Your data is kept while it's off.",
    action: "Start engine",
  },
  broken: {
    title: "The engine stopped unexpectedly",
    body: "Its VM stopped or didn't start. Starting it again usually brings it back; your volumes and images are kept.",
    action: "Start engine",
  },
};

const art = <AppMark size={48} />;

/** Shown in place of a view that needs the engine while it isn't running. */
export function EngineOff({ phase }: { phase: EnginePhase | undefined }) {
  const control = useEngineControl();
  const { data: status } = useEngineStatus();
  // Asleep with a window showing means the engine is already waking for it.
  if (phase === "starting" || phase === "stopping" || phase === "asleep" || control.isPending) {
    return (
      <EmptyState
        art={art}
        title={phase === "stopping" ? "Stopping the engine" : "Starting the engine"}
        className="h-full"
      >
        <p className="m-0">Booting the Linux VM and Docker.</p>
        <Progress label="Engine progress" className="mx-auto mt-2 w-60" />
      </EmptyState>
    );
  }
  if (phase === "missing") {
    return (
      <EmptyState art={art} title="The engine isn't in this build" className="h-full">
        Release builds include Containeria's engine. For a development build, make it with{" "}
        <code className="font-mono text-mono-13 select-text">scripts/build-engine.sh</code>.
      </EmptyState>
    );
  }
  const idle = IDLE[phase === "notCreated" || phase === "broken" ? phase : "stopped"];
  return (
    <EmptyState
      art={art}
      title={idle.title}
      className="h-full"
      actions={
        <>
          <Button variant="brand" size="lg" onClick={() => control.mutate("start")}>
            <IconPlayerPlay />
            {idle.action}
          </Button>
          <Button size="lg" onClick={() => openSettings("engine")}>
            Engine settings
          </Button>
        </>
      }
    >
      {idle.body}
      {phase === "broken" && status?.problem ? (
        <p className="m-0 mt-2 text-12 text-ink-3 select-text">{status.problem}</p>
      ) : null}
    </EmptyState>
  );
}
