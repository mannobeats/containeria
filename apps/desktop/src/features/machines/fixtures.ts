import type { Distro, Machine } from "@/lib/ipc/bindings";

export function machineFixture(overrides: Partial<Machine> = {}): Machine {
  return {
    name: "ubuntu-dev",
    distro: "ubuntu",
    release: "24.04",
    user: "ada",
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
  { id: "alpine", name: "Alpine", releases: [{ alias: "3.24", label: "3.24" }] },
];
