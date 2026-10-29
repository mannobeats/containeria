import { IconFileImport, IconPlus } from "@tabler/icons-react";
import { useState } from "react";

import { formatMemory, plural } from "@/lib/format";
import type { EnginePhase, Machine } from "@/lib/ipc/bindings";
import { Crumb, Page } from "@/shell/page";
import { Button } from "@/ui/button";
import { Skeleton } from "@/ui/progress";

import { PromptSheet } from "@/ui/prompt-sheet";

import {
  pickExport,
  useImportMachine,
  useMachineAction,
  useMachines,
  useMachinesStatus,
} from "./api";
import { MachineCard } from "./machine-card";
import { MachineDialogs } from "./machine-dialogs";
import type { MachineDialog } from "./machine-menu";
import { MachinesIntro } from "./machines-intro";
import { importName, isRunning, type ListedMachine, type MachineList, nameProblem } from "./model";
import { NewMachineSheet } from "./new-machine-sheet";
import { useNewMachineSheet } from "./new-machine-store";

function Lede({ machines }: { machines: ListedMachine[] }) {
  const running = machines.filter(isRunning);
  const memory = running.reduce((total, machine) => total + machine.memoryBytes, 0);
  return (
    <p className="m-0 max-w-[78ch] px-5 pb-4 text-14 text-pretty text-ink-2 [&_b]:font-semibold [&_b]:text-ink">
      <b>
        {running.length} of {plural(machines.length, "machine")}
      </b>{" "}
      running, using <b className="tabular">{formatMemory(memory)}</b>. Each one runs in the
      machines VM and can mount your Mac home folder.
    </p>
  );
}

function NewCard({ onNew }: { onNew: () => void }) {
  return (
    <button
      type="button"
      onClick={onNew}
      className="flex min-h-[200px] flex-col items-center justify-center gap-1.5 rounded-lg text-ink-2 shadow-[inset_0_0_0_1px_var(--line-strong)] transition-colors duration-140 hover:bg-hover"
    >
      <IconPlus className="size-5 text-ink-3" aria-hidden />
      <b className="font-medium">New machine</b>
      <span className="text-12 text-ink-3">Ubuntu, Debian, Fedora, Arch and 5 more</span>
    </button>
  );
}

type Picked = { machine: Machine; dialog: MachineDialog };

function MachineGrid({ list, onNew }: { list: MachineList | undefined; onNew: () => void }) {
  const action = useMachineAction();
  const [picked, setPicked] = useState<Picked | null>(null);
  return (
    <>
      <h1 className="m-0 px-5 pt-[18px] pb-2.5 text-20 font-semibold tracking-[-0.012em] text-ink">
        Linux machines
      </h1>
      {list ? <Lede machines={list.machines} /> : <Skeleton className="mx-5 mb-4 h-4 w-96" />}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4 px-5 pb-10">
        {list?.machines.map((machine) => (
          <MachineCard
            key={machine.name}
            machine={machine}
            act={(name, verb) => action.mutate({ name, action: verb })}
            onDialog={(dialog) => setPicked({ machine, dialog })}
          />
        ))}
        <NewCard onNew={onNew} />
      </div>
      <MachineDialogs
        machine={picked?.machine ?? null}
        dialog={picked?.dialog ?? null}
        taken={list?.machines.map((machine) => machine.name) ?? []}
        onClose={() => setPicked(null)}
      />
    </>
  );
}

const listsMachines = (phase: EnginePhase | undefined) =>
  phase === "running" || phase === "stopped";

/** Running or stopped with at least one machine, or the intro for the machines VM's phase. */
function introPhase(
  phase: EnginePhase | undefined,
  list: MachineList | undefined,
): EnginePhase | null {
  if (phase === undefined) {
    return null;
  }
  if (!listsMachines(phase)) {
    return phase;
  }
  return list?.machines.length === 0 ? "notCreated" : null;
}

/** Import… from the header: pick an exported `.tar.gz`, then name the new machine. */
function ImportButton({ taken }: { taken: string[] }) {
  const [source, setSource] = useState<string | null>(null);
  const importMachine = useImportMachine();
  const choose = () =>
    pickExport()
      .then(setSource)
      .catch(() => undefined);
  return (
    <>
      <Button onClick={choose}>
        <IconFileImport />
        Import…
      </Button>
      <PromptSheet
        open={source !== null}
        onOpenChange={(open) => (open ? undefined : setSource(null))}
        title="Import a machine"
        label="Name"
        initial={source ? importName(source, taken) : ""}
        hint={`From ${source?.split("/").at(-1) ?? ""}`}
        action="Import"
        validate={(name) => nameProblem(name, taken) ?? undefined}
        onSubmit={(name) => {
          if (source) {
            importMachine.mutate({ source, name });
          }
        }}
      />
    </>
  );
}

export function MachinesPage() {
  const { data: status } = useMachinesStatus();
  const { data: list } = useMachines();
  const creating = useNewMachineSheet((state) => state.open);
  const setCreating = useNewMachineSheet((state) => state.setOpen);
  const intro = introPhase(status?.phase, list);
  const showGrid = listsMachines(status?.phase) && intro === null;
  const taken = list?.machines.map((machine) => machine.name) ?? [];
  const tools = listsMachines(status?.phase) ? (
    <>
      {status?.phase === "running" ? <ImportButton taken={taken} /> : null}
      {showGrid ? (
        <Button variant="brand" onClick={() => setCreating(true)}>
          <IconPlus />
          New machine
        </Button>
      ) : null}
    </>
  ) : null;
  return (
    <Page crumbs={<Crumb>Linux machines</Crumb>} tools={tools}>
      {intro ? <MachinesIntro phase={intro} onNew={() => setCreating(true)} /> : null}
      {showGrid ? <MachineGrid list={list} onNew={() => setCreating(true)} /> : null}
      <NewMachineSheet
        open={creating}
        onOpenChange={setCreating}
        supportsVms={status?.supportsVms ?? false}
        taken={taken}
      />
    </Page>
  );
}
