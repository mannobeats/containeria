import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Channel } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";

import { useToastedMutation } from "@/app/use-toasted-mutation";
import { copyText } from "@/lib/clipboard";
import {
  type CreateMachine,
  commands,
  events,
  type LogLine,
  type MachineAction,
} from "@/lib/ipc/bindings";
import { errorMessage } from "@/lib/ipc/errors";
import { useTauriEvent } from "@/lib/ipc/use-tauri-event";

import { type MachineList, withCpu } from "./model";

export const machineKeys = {
  all: ["machines"],
  status: ["machines", "status"],
  list: ["machines", "list"],
  distros: ["machines", "distros"],
  files: (name: string, path: string) => ["machines", "files", name, path],
  snapshots: (name: string) => ["machines", "snapshots", name],
} as const;

/** The machines VM's phase. Refetches whenever Rust says machines changed. */
export function useMachinesStatus() {
  const client = useQueryClient();
  useTauriEvent(events.machinesChanged, () => {
    client.invalidateQueries({ queryKey: machineKeys.all }).catch(() => undefined);
  });
  return useQuery({
    queryKey: machineKeys.status,
    queryFn: commands.machinesStatus,
    refetchInterval: 15_000,
  });
}

/**
 * Every machine, polled every three seconds while shown so usage stays live. While the machines VM
 * is off, the ones it had, stopped; starting one starts the VM.
 */
export function useMachines() {
  const client = useQueryClient();
  const { data: status } = useMachinesStatus();
  return useQuery({
    queryKey: machineKeys.list,
    queryFn: async () => {
      const machines = await commands.machinesList();
      return withCpu(client.getQueryData<MachineList>(machineKeys.list), machines, Date.now());
    },
    enabled: status?.phase === "running" || status?.phase === "stopped",
    refetchInterval: status?.phase === "running" ? 3000 : false,
  });
}

export function useDistros() {
  return useQuery({
    queryKey: machineKeys.distros,
    queryFn: commands.machineDistros,
    staleTime: Number.POSITIVE_INFINITY,
  });
}

export function useMachineFiles(name: string, path: string) {
  return useQuery({
    queryKey: machineKeys.files(name, path),
    queryFn: () => commands.machineFiles(name, path),
  });
}

type Control = "start" | "stop";

/** Starts or stops the machines VM, passing Colima's progress lines to `onLine`. */
export function useMachinesControl(onLine: (line: LogLine) => void) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (control: Control) => {
      const progress = new Channel<LogLine>(onLine);
      return control === "start"
        ? commands.machinesStart(progress)
        : commands.machinesStop(progress);
    },
    onError: (error) =>
      toast.error("Linux machines didn't respond", { description: errorMessage(error) }),
    onSettled: () => client.invalidateQueries({ queryKey: machineKeys.all }),
  });
}

const past: Record<MachineAction, string> = {
  start: "Started",
  stop: "Stopped",
  restart: "Restarted",
};

export function useMachineAction() {
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: ({ name, action }: { name: string; action: MachineAction }) =>
      commands.machineAct(name, action),
    onSuccess: (_, { name, action }) =>
      toast.success(`${past[action]} ${name}`, {
        ...(action === "stop"
          ? { action: { label: "Undo", onClick: () => mutation.mutate({ name, action: "start" }) } }
          : {}),
      }),
    onError: (error, { name }) =>
      toast.error(`${name} didn't respond`, { description: errorMessage(error) }),
    onSettled: () => client.invalidateQueries({ queryKey: machineKeys.all }),
  });
  return mutation;
}

export function useDeleteMachine() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => commands.machineDelete(name),
    onSuccess: (_, name) => toast.success(`Deleted ${name}`),
    onError: (error, name) =>
      toast.error(`${name} wasn't deleted`, { description: errorMessage(error) }),
    onSettled: () => client.invalidateQueries({ queryKey: machineKeys.all }),
  });
}

/** Creates a machine, setting up the machines VM first if needed; `onProgress` gets each step. */
export function useCreateMachine(onProgress: (message: string) => void) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (request: CreateMachine) =>
      commands.machineCreate(request, new Channel<string>(onProgress)),
    onSuccess: (_, request) => toast.success(`${request.name} is ready`),
    onError: (error) =>
      toast.error("The machine wasn't created", { description: errorMessage(error) }),
    onSettled: () => client.invalidateQueries({ queryKey: machineKeys.all }),
  });
}

export function useMachineSnapshots(name: string) {
  return useQuery({
    queryKey: machineKeys.snapshots(name),
    queryFn: () => commands.machineSnapshots(name),
  });
}

type SnapshotInput = { name: string; snapshot: string };

export function useTakeSnapshot() {
  return useToastedMutation({
    run: ({ name, snapshot }: SnapshotInput) => commands.machineSnapshotCreate(name, snapshot),
    done: ({ snapshot }) => `Took snapshot ${snapshot}`,
    failed: "The snapshot wasn't taken",
    invalidates: machineKeys.all,
  });
}

export function useRestoreSnapshot() {
  return useToastedMutation({
    run: ({ name, snapshot }: SnapshotInput) => commands.machineSnapshotRestore(name, snapshot),
    done: ({ name, snapshot }) => `Restored ${name} to ${snapshot}`,
    failed: "The snapshot wasn't restored",
    invalidates: machineKeys.all,
  });
}

export function useDeleteSnapshot() {
  return useToastedMutation({
    run: ({ name, snapshot }: SnapshotInput) => commands.machineSnapshotDelete(name, snapshot),
    done: ({ snapshot }) => `Deleted snapshot ${snapshot}`,
    failed: "The snapshot wasn't deleted",
    invalidates: machineKeys.all,
  });
}

type Job<T> = {
  run: (input: T) => Promise<unknown>;
  doing: (input: T) => string;
  done: (input: T) => string;
  failed: string;
};

/** A mutation that can take minutes, so it shows a toast while it runs. */
function useMachineJob<T>({ run, doing, done, failed }: Job<T>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: run,
    onMutate: (input) => toast.loading(doing(input)),
    onSuccess: (_, input, loading) => toast.success(done(input), { id: loading }),
    onError: (error, _, loading) =>
      toast.error(failed, {
        description: errorMessage(error),
        ...(loading ? { id: loading } : {}),
      }),
    onSettled: () => client.invalidateQueries({ queryKey: machineKeys.all }),
  });
}

export function useCloneMachine() {
  return useMachineJob({
    run: ({ name, to }: { name: string; to: string }) => commands.machineClone(name, to),
    doing: ({ name }) => `Cloning ${name}…`,
    done: ({ name, to }) => `Cloned ${name} as ${to}`,
    failed: "The machine wasn't cloned",
  });
}

export function useImportMachine() {
  return useMachineJob({
    run: ({ source, name }: { source: string; name: string }) =>
      commands.machineImport(source, name),
    doing: ({ name }) => `Importing ${name}…`,
    done: ({ name }) => `Imported ${name}`,
    failed: "The machine wasn't imported",
  });
}

/** Asks for a `.tar.gz` that Export… wrote, with the macOS open panel. */
export async function pickExport(): Promise<string | null> {
  const file = await open({
    title: "Choose a machine to import",
    filters: [{ name: "Exported machine", extensions: ["gz", "tgz"] }],
  });
  return typeof file === "string" ? file : null;
}

/** Asks where to save, then writes the machine there as a `.tar.gz` that Import… reads. */
export async function exportMachine(name: string) {
  const destination = await save({
    title: `Export ${name}`,
    defaultPath: `${name}.tar.gz`,
    filters: [{ name: "Exported machine", extensions: ["gz"] }],
  });
  if (!destination) {
    return;
  }
  const saving = toast.loading(`Exporting ${name}…`);
  try {
    await commands.machineExport(name, destination);
    toast.success(`Saved ${destination.split("/").at(-1)}`, {
      id: saving,
      action: {
        label: "Show in Finder",
        onClick: () => revealItemInDir(destination).catch(() => undefined),
      },
    });
  } catch (error) {
    toast.error("The export failed", { id: saving, description: errorMessage(error) });
  }
}

/** Opens a root shell in the machine in a Terminal window. */
export function openInTerminal(name: string) {
  commands
    .machineOpenTerminal(name)
    .catch((error: unknown) =>
      toast.error("Terminal didn't open", { description: errorMessage(error) }),
    );
}

export function copyShellCommand(name: string) {
  commands
    .machineShellCommand(name)
    .then((command) => copyText("Command", command))
    .catch((error: unknown) =>
      toast.error("The command wasn't copied", { description: errorMessage(error) }),
    );
}
