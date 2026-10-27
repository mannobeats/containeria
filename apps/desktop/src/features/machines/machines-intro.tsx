import { IconPlayerPlay, IconPlus } from "@tabler/icons-react";
import { useState } from "react";

import type { EnginePhase } from "@/lib/ipc/bindings";
import { Button } from "@/ui/button";
import { EmptyState } from "@/ui/empty-state";
import { Progress } from "@/ui/progress";
import { Tile } from "@/ui/tile";

import { useMachinesControl } from "./api";

const art = <Tile icon="machine" size="xl" />;

function Busy({ phase, line }: { phase: EnginePhase; line: string }) {
  return (
    <EmptyState
      art={art}
      title={phase === "stopping" ? "Stopping Linux machines" : "Starting Linux machines"}
      className="h-full"
    >
      <p className="m-0">Booting the machines VM and Incus.</p>
      <Progress label="Machines progress" className="mx-auto mt-2 w-60" />
      <p className="m-0 mt-0.5 h-5 truncate text-12 text-ink-3">{line}</p>
    </EmptyState>
  );
}

type IntroProps = { phase: EnginePhase; onNew: () => void };

/** What the area shows until the machines VM runs: why there is a second VM, and how to start it. */
export function MachinesIntro({ phase, onNew }: IntroProps) {
  const [line, setLine] = useState("");
  const control = useMachinesControl((progress) => setLine(progress.message));
  if (phase === "starting" || phase === "stopping" || control.isPending) {
    return <Busy phase={phase} line={line} />;
  }
  if (phase === "missing") {
    return (
      <EmptyState art={art} title="Colima isn't installed" className="h-full">
        Linux machines run in a Colima VM. Release builds include it; for a development build
        install it with{" "}
        <code className="font-mono text-mono-13 select-text">brew install colima</code>.
      </EmptyState>
    );
  }
  if (phase === "notCreated") {
    return (
      <EmptyState
        art={art}
        title="No Linux machines yet"
        className="h-full"
        actions={
          <Button variant="brand" size="lg" onClick={onNew}>
            <IconPlus />
            New machine
          </Button>
        }
      >
        A full Ubuntu, Debian, Fedora or Arch system that shares your Mac's files. Machines run in
        their own small VM next to the engine; Containeria sets it up with your first machine.
      </EmptyState>
    );
  }
  return (
    <EmptyState
      art={art}
      title={phase === "broken" ? "Linux machines need a restart" : "Linux machines are stopped"}
      className="h-full"
      actions={
        <Button variant="brand" size="lg" onClick={() => control.mutate("start")}>
          <IconPlayerPlay />
          Start Linux machines
        </Button>
      }
    >
      Your machines and their files are kept while the machines VM is off.
    </EmptyState>
  );
}
