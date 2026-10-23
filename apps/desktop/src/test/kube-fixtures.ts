import type { Cluster, PodSummary } from "@/lib/ipc/bindings";

export function podFixture(overrides: Partial<PodSummary> = {}): PodSummary {
  return {
    namespace: "shop",
    name: "storefront-6f9c-abcde",
    status: "Running",
    problem: null,
    ready: 1,
    containers: ["web"],
    restarts: 0,
    node: "colima-containeria",
    ip: "10.42.0.12",
    owner: "ReplicaSet/storefront-6f9c",
    createdAt: 1_792_000_000,
    ...overrides,
  };
}

export function clusterFixture(overrides: Partial<Cluster> = {}): Cluster {
  return {
    version: "v1.35.0+k3s1",
    namespaces: ["default", "kube-system", "shop"],
    pods: [
      podFixture(),
      podFixture({
        name: "checkout-7d9f-x2",
        status: "CrashLoopBackOff",
        problem: "CrashLoopBackOff",
        ready: 0,
        restarts: 14,
      }),
      podFixture({ namespace: "kube-system", name: "coredns-ccb9", owner: null }),
    ],
    deployments: [
      {
        namespace: "shop",
        name: "storefront",
        ready: 2,
        desired: 3,
        upToDate: 3,
        available: 2,
        images: ["shop-web:dev"],
        createdAt: 1_792_000_000,
      },
    ],
    services: [
      {
        namespace: "shop",
        name: "storefront",
        kind: "LoadBalancer",
        clusterIp: "10.43.0.8",
        ports: [{ port: 8080, target: "http", protocol: "TCP", nodePort: 31234 }],
        fromMac: "localhost:8080",
      },
      {
        namespace: "shop",
        name: "orders-db",
        kind: "ClusterIP",
        clusterIp: "10.43.0.9",
        ports: [{ port: 5432, target: "5432", protocol: "TCP", nodePort: null }],
        fromMac: null,
      },
    ],
    ingresses: [
      {
        namespace: "shop",
        name: "storefront",
        class: "traefik",
        tls: true,
        routes: [{ host: "shop.test", path: "/", backend: "storefront:80" }],
      },
    ],
    config: [
      {
        namespace: "shop",
        name: "storefront-env",
        kind: "configMap",
        secretType: null,
        keys: ["API_URL", "LOG_LEVEL"],
        createdAt: 1_792_000_000,
      },
      {
        namespace: "shop",
        name: "db-credentials",
        kind: "secret",
        secretType: "Opaque",
        keys: ["password"],
        createdAt: 1_792_000_000,
      },
    ],
    ...overrides,
  };
}
