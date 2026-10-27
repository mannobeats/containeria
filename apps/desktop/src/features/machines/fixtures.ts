import type { Distro, Machine, MachinesStatus } from "@/lib/ipc/bindings";

export function machineFixture(overrides: Partial<Machine> = {}): Machine {
  return {
    name: "ubuntu-dev",
    distro: "Ubuntu",
    release: "24.04",
    kind: "container",
    state: "running",
    ipv4: "10.214.83.12",
    memoryBytes: 310 * 1024 ** 2,
    cpuSeconds: 12,
    processes: 31,
    cpuLimit: "2",
    memoryLimit: "4GiB",
    home: "/Users/ada",
    createdAt: "2026-10-16T09:12:44Z",
    ...overrides,
  };
}

export function machinesStatusFixture(overrides: Partial<MachinesStatus> = {}): MachinesStatus {
  return { phase: "running", instance: null, supportsVms: false, ...overrides };
}

export const distrosFixture: Distro[] = [
  {
    id: "ubuntu",
    name: "Ubuntu",
    releases: [
      { alias: "24.04", label: "24.04 LTS" },
      { alias: "22.04", label: "22.04 LTS" },
    ],
  },
  { id: "debian", name: "Debian", releases: [{ alias: "13", label: "13 trixie" }] },
  { id: "archlinux", name: "Arch Linux", releases: [{ alias: "current", label: "rolling" }] },
];
