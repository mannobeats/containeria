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
  return freeName(distro.replace(/linux$/, "") || "machine", taken);
}

/** `base` if no machine has it, else `base-2`, `base-3`… */
export function freeName(base: string, taken: string[]): string {
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

/** A machine name from an exported file's name: `~/Desktop/Ubuntu Dev.tar.gz` → `ubuntu-dev`. */
export function importName(path: string, taken: string[]): string {
  const file = path.split("/").at(-1) ?? "";
  const base = file
    .replace(/\.(tar\.gz|tgz|tar)$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^[^a-z]+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 63)
    .replace(/-+$/, "");
  return freeName(base || "machine", taken);
}

const pad = (value: number) => String(value).padStart(2, "0");

/** The default snapshot name: the local date and time, `2026-10-17-1530`. */
export function snapshotName(at: Date): string {
  const date = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
  return `${date}-${pad(at.getHours())}${pad(at.getMinutes())}`;
}

/** Same rules as the Incus snapshot names Containeria accepts. */
export function snapshotProblem(name: string, taken: string[]): string | null {
  if (name === "") {
    return "Give the snapshot a name.";
  }
  if (taken.includes(name)) {
    return "A snapshot with this name exists.";
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/.test(name)) {
    return "Use letters, numbers, dots, dashes and underscores.";
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
