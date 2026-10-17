import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Channel } from "@tauri-apps/api/core";
import { toast } from "sonner";

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

/** Every machine, polled every three seconds while shown so usage stays live. */
export function useMachines() {
  const client = useQueryClient();
  const { data: status } = useMachinesStatus();
  return useQuery({
    queryKey: machineKeys.list,
    queryFn: async () => {
      const machines = await commands.machinesList();
      return withCpu(client.getQueryData<MachineList>(machineKeys.list), machines, Date.now());
    },
    enabled: status?.phase === "running",
    refetchInterval: 3000,
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
