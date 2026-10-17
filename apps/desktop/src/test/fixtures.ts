import type {
  ContainerSummary,
  EngineStatus,
  ImageSummary,
  Metrics,
  NetworkSummary,
  VolumeSummary,
} from "@/lib/ipc/bindings";

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

export function imageFixture(overrides: Partial<ImageSummary> = {}): ImageSummary {
  return {
    id: "sha256:0123456789abcdef",
    repository: "nginx",
    tag: "1.29",
    references: ["nginx:1.29"],
    sizeBytes: 190_000_000,
    createdAt: 1_760_000_000,
    containers: 0,
    dangling: false,
    ...overrides,
  };
}

export function volumeFixture(overrides: Partial<VolumeSummary> = {}): VolumeSummary {
  return {
    name: "shop_pgdata",
    driver: "local",
    createdAt: "2026-10-01T10:00:00Z",
    sizeBytes: 48_000_000,
    project: "shop",
    anonymous: false,
    usedBy: [],
    ...overrides,
  };
}

export function networkFixture(overrides: Partial<NetworkSummary> = {}): NetworkSummary {
  return {
    id: "n3tw0rk",
    name: "shop_default",
    driver: "bridge",
    scope: "local",
    subnet: "172.18.0.0/16",
    gateway: "172.18.0.1",
    internal: false,
    ipv6: false,
    builtIn: false,
    project: "shop",
    containers: [],
    ...overrides,
  };
}
