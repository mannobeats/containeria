import { IconPlayerPlay, IconRefresh } from "@tabler/icons-react";
import { Link } from "@tanstack/react-router";

import type { EnginePhase } from "@/lib/ipc/bindings";
import { AppMark } from "@/ui/app-mark";
import { Button } from "@/ui/button";
import { buttonClass } from "@/ui/button-class";
import { EmptyState } from "@/ui/empty-state";
import { Progress } from "@/ui/progress";

import { useBootLog, useEngineControl } from "./api";

type Idle = "notCreated" | "stopped" | "broken";

const IDLE: Record<
  Idle,
  { title: string; body: string; action: string; control: "start" | "restart" }
> = {
  notCreated: {
    title: "Set up the engine",
    body: "Containeria creates a small Linux VM for Docker. The first start downloads its disk image and takes about a minute.",
    action: "Create engine",
    control: "start",
  },
  stopped: {
    title: "The engine is stopped",
    body: "Containers, Kubernetes and Linux machines run inside it. Your data is kept while it's off.",
    action: "Start engine",
    control: "start",
  },
  broken: {
    title: "The engine needs a restart",
    body: "Colima reports the VM as broken. A restart usually brings it back; your volumes and images are kept.",
    action: "Restart engine",
    control: "restart",
  },
};

function LastLine() {
  const line = useBootLog((state) => state.lines.at(-1));
  return <p className="m-0 mt-0.5 h-5 truncate text-12 text-ink-3">{line?.message ?? ""}</p>;
}

const art = <AppMark size={48} />;

/** Shown in place of a view that needs the engine while it isn't running. */
export function EngineOff({ phase }: { phase: EnginePhase | undefined }) {
  const control = useEngineControl();
  if (phase === "starting" || phase === "stopping" || control.isPending) {
    return (
      <EmptyState
        art={art}
        title={phase === "stopping" ? "Stopping the engine" : "Starting the engine"}
        className="h-full"
      >
        <p className="m-0">Booting the Linux VM and Docker.</p>
        <Progress label="Engine progress" className="mx-auto mt-2 w-60" />
        <LastLine />
      </EmptyState>
    );
  }
  if (phase === "missing") {
    return (
      <EmptyState art={art} title="Colima isn't installed" className="h-full">
        Containeria runs its engine with Colima. Release builds include it; for a development build
        install it with{" "}
        <code className="font-mono text-mono-13 select-text">brew install colima</code>.
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
          <Button variant="brand" size="lg" onClick={() => control.mutate(idle.control)}>
            {idle.control === "restart" ? <IconRefresh /> : <IconPlayerPlay />}
            {idle.action}
          </Button>
          <Link to="/settings" className={buttonClass({ size: "lg" })}>
            Engine settings
          </Link>
        </>
      }
    >
      {idle.body}
    </EmptyState>
  );
}
