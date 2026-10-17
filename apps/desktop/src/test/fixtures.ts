import type { ContainerSummary, EngineStatus, Metrics, Preferences } from "@/lib/ipc/bindings";

export function containerFixture(overrides: Partial<ContainerSummary> = {}): ContainerSummary {
  return {
    id: "c0ffee",
    name: "web",
    image: "nginx:1.29",
    state: "running",
    status: "Up 2 hours",
    project: null,
    service: null,
    pod: null,
    ports: [],
    createdAt: 1_760_000_000,
    ...overrides,
  };
}

export function engineFixture(overrides: Partial<EngineStatus> = {}): EngineStatus {
  return {
    phase: "running",
    instance: null,
    config: {
      cpus: 4,
      memoryGib: 8,
      diskGib: 100,
      vmType: "vz",
      rosetta: true,
      kubernetes: { enabled: false, version: "v1.35.0+k3s1" },
      fileWatchEvents: true,
      forwardSshAgent: true,
      udpPorts: false,
      containerIpAccess: false,
      setDockerContext: true,
      registryMirrors: [],
      insecureRegistries: [],
    },
    returnsMemory: false,
    dockerSocket: "/Users/ada/.containeria/colima/containeria/docker.sock",
    ...overrides,
  };
}

export function metricsFixture(overrides: Partial<Metrics> = {}): Metrics {
  return {
    sampledAtMs: 0,
    containers: [],
    ledger: { totalBytes: 8 * 1024 ** 3, usedBytes: 0, segments: [] },
    ...overrides,
  };
}

export function preferencesFixture(overrides: Partial<Preferences> = {}): Preferences {
  return { keepRunningInMenuBar: true, memoryInMenuBar: true, onboarded: true, ...overrides };
}
