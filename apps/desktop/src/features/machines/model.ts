import type { Machine, MachineState } from "@/lib/ipc/bindings";

export const isRunning = (machine: Machine) => machine.state === "running";

const STATE_LABELS: Record<MachineState, string> = {
  running: "Running",
  stopped: "Stopped",
  frozen: "Paused",
  error: "Error",
  busy: "Working…",
};

export function stateLabel(machine: Machine): string {
  return STATE_LABELS[machine.state];
}

export function kindLabel(machine: Pick<Machine, "kind">): string {
  return machine.kind === "vm" ? "Full VM" : "System container";
}

/** Incus writes memory limits like "4GiB"; people read "4 GB". */
export function limitLabel(limit: string | null): string | null {
  return (
    limit?.replace(
      /^(\d+(?:\.\d+)?)\s*(K|M|G|T)i?B$/i,
      (_, size: string, unit: string) => `${size} ${unit.toUpperCase()}B`,
    ) ?? null
  );
}

/** A free name for a new machine of this distribution: "ubuntu", then "ubuntu-2", "ubuntu-3"… */
export function suggestName(distro: string, taken: string[]): string {
  const base = distro.replace(/linux$/, "") || "machine";
  const used = new Set(taken);
  let name = base;
  for (let copy = 2; used.has(name); copy++) {
    name = `${base}-${copy}`;
  }
  return name;
}

/** Same rules as Incus host names, said the way a person can fix them. */
export function nameProblem(name: string, taken: string[]): string | null {
  if (name === "") {
    return "Give the machine a name.";
  }
  if (taken.includes(name)) {
    return "A machine with this name exists.";
  }
  if (!/^[a-z]/.test(name)) {
    return "Start the name with a lowercase letter.";
  }
  if (!/^[a-z0-9-]{1,63}$/.test(name) || name.endsWith("-")) {
    return "Use lowercase letters, numbers and dashes.";
  }
  return null;
}

export type CpuSample = { cpuSeconds: number | null; at: number };

/** CPU use between two samples, where 100 is one full core. */
export function cpuPercent(before: CpuSample | undefined, after: CpuSample): number | null {
  if (!before || before.cpuSeconds === null || after.cpuSeconds === null || after.at <= before.at) {
    return null;
  }
  return Math.max(
    0,
    ((after.cpuSeconds - before.cpuSeconds) / ((after.at - before.at) / 1000)) * 100,
  );
}

export type ListedMachine = Machine & { cpuPercent: number | null };

export type MachineList = { at: number; machines: ListedMachine[] };

/** Adds each machine's CPU use since the previous list, matched by name. */
export function withCpu(
  previous: MachineList | undefined,
  machines: Machine[],
  at: number,
): MachineList {
  const before = new Map(previous?.machines.map((machine) => [machine.name, machine.cpuSeconds]));
  return {
    at,
    machines: machines.map((machine) => ({
      ...machine,
      cpuPercent: cpuPercent(
        previous && before.has(machine.name)
          ? { cpuSeconds: before.get(machine.name) ?? null, at: previous.at }
          : undefined,
        { cpuSeconds: machine.cpuSeconds, at },
      ),
    })),
  };
}
