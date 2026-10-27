import type { Machine } from "@/lib/ipc/bindings";
import { PromptSheet } from "@/ui/prompt-sheet";

import { useCloneMachine, useMachineSnapshots, useTakeSnapshot } from "./api";
import { DeleteMachineSheet } from "./delete-machine-sheet";
import type { MachineDialog } from "./machine-menu";
import { freeName, nameProblem, snapshotName, snapshotProblem } from "./model";

type SheetProps = { machine: Machine; onClose: () => void };

function SnapshotSheet({ machine, onClose }: SheetProps) {
  const { data: snapshots = [] } = useMachineSnapshots(machine.name);
  const take = useTakeSnapshot();
  const taken = snapshots.map((snapshot) => snapshot.name);
  return (
    <PromptSheet
      open
      onOpenChange={(next) => (next ? undefined : onClose())}
      title={`Take a snapshot of ${machine.name}`}
      label="Snapshot name"
      initial={snapshotName(new Date())}
      hint="Saves the disk as it is now. A running machine keeps running."
      action="Take snapshot"
      validate={(name) => snapshotProblem(name, taken) ?? undefined}
      onSubmit={(snapshot) => take.mutate({ name: machine.name, snapshot })}
    />
  );
}

function CloneSheet({ machine, onClose, taken }: SheetProps & { taken: string[] }) {
  const clone = useCloneMachine();
  return (
    <PromptSheet
      open
      onOpenChange={(next) => (next ? undefined : onClose())}
      title={`Clone ${machine.name}`}
      label="Name"
      initial={freeName(`${machine.name}-copy`, taken)}
      hint="A stopped copy of its disk and settings, without its snapshots."
      action="Clone"
      validate={(name) => nameProblem(name, taken) ?? undefined}
      onSubmit={(to) => clone.mutate({ name: machine.name, to })}
    />
  );
}

type MachineDialogsProps = {
  machine: Machine | null;
  dialog: MachineDialog | null;
  /** Every machine's name, so a clone gets a free one. */
  taken: string[];
  onClose: () => void;
  onDeleted?: () => void;
};

/** The sheets a machine's menu opens, for whichever machine asked. */
export function MachineDialogs({
  machine,
  dialog,
  taken,
  onClose,
  onDeleted,
}: MachineDialogsProps) {
  return (
    <>
      <DeleteMachineSheet
        machine={dialog === "delete" ? machine : null}
        onClose={onClose}
        {...(onDeleted ? { onDeleted } : {})}
      />
      {machine && dialog === "snapshot" ? (
        <SnapshotSheet machine={machine} onClose={onClose} />
      ) : null}
      {machine && dialog === "clone" ? (
        <CloneSheet machine={machine} onClose={onClose} taken={taken} />
      ) : null}
    </>
  );
}
