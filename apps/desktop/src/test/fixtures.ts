import type {
  ContainerDetails,
  ContainerSummary,
  EngineStatus,
  ImageSummary,
  LogEntry,
  Metrics,
  NetworkSummary,
  Preferences,
  StatsSample,
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
  return {
    keepRunningInMenuBar: true,
    memoryInMenuBar: true,
    onboarded: true,
    notifyOn: ["crash", "unhealthy", "finished", "lowMemory"],
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

export function detailsFixture(overrides: Partial<ContainerDetails> = {}): ContainerDetails {
  return {
    id: "db0123456789abcdef",
    name: "shop-db-1",
    image: "postgres:18",
    imageId: "sha256:1",
    command: "docker-entrypoint.sh postgres",
    state: "running",
    createdAt: "2026-10-17T08:00:00Z",
    startedAt: "2026-10-17T08:00:01Z",
    finishedAt: null,
    exitCode: 0,
    error: null,
    restartCount: 0,
    restartPolicy: "unless-stopped",
    platform: "linux",
    ipAddress: "172.20.0.3",
    networks: ["shop_default"],
    project: "shop",
    service: "db",
    ports: [{ container: 5432, host: 5433, protocol: "tcp" }],
    mounts: [
      { kind: "volume", source: "shop_pg", destination: "/var/lib/postgresql", readOnly: false },
    ],
    env: [
      { key: "POSTGRES_PASSWORD", value: "hunter2" },
      { key: "PGDATA", value: "/var/lib/postgresql/data" },
    ],
    health: null,
    raw: '{\n  "Id": "db0123456789abcdef",\n  "RestartCount": 0\n}',
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

export function statsFixture(overrides: Partial<StatsSample> = {}): StatsSample {
  return {
    cpuPercent: 3.5,
    memoryBytes: 64 * 1024 ** 2,
    memoryLimitBytes: 0,
    networkRxBytes: 1000,
    networkTxBytes: 500,
    diskReadBytes: 0,
    diskWriteBytes: 0,
    ...overrides,
  };
}

export function logFixture(message: string, level: LogEntry["level"] = "info"): LogEntry {
  return { stream: "stdout", timestamp: "2026-10-17T08:00:02.000000000Z", level, message };
}
