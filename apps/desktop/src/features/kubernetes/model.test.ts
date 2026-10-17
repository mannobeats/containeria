import { describe, expect, it } from "vitest";

import { containerFixture, metricsFixture } from "@/test/fixtures";
import { clusterFixture, podFixture } from "@/test/kube-fixtures";

import { asTab, crashing, k3sVersion, podMemory, sortPods, tabCounts, visible } from "./model";

describe("visible", () => {
  const cluster = clusterFixture();

  it("filters by namespace", () => {
    expect(visible(cluster.pods, "kube-system", "").map((pod) => pod.name)).toEqual([
      "coredns-ccb9",
    ]);
  });

  it("searches name, namespace and extra fields, ignoring case", () => {
    expect(
      visible(cluster.pods, null, "crashloop", (pod) => [pod.status]).map((pod) => pod.name),
    ).toEqual(["checkout-7d9f-x2"]);
    expect(visible(cluster.ingresses, "shop", "STOREFRONT")).toHaveLength(1);
    expect(visible(cluster.ingresses, "shop", "shop.test")).toHaveLength(0);
  });
});

describe("podMemory", () => {
  it("adds up the Docker containers of each pod", () => {
    const memory = podMemory(
      [
        containerFixture({ id: "a", pod: "shop/web" }),
        containerFixture({ id: "b", pod: "shop/web" }),
        containerFixture({ id: "c", pod: null }),
      ],
      metricsFixture({
        containers: [
          { id: "a", cpuPercent: null, memoryBytes: 10 },
          { id: "b", cpuPercent: null, memoryBytes: 5 },
          { id: "c", cpuPercent: null, memoryBytes: 99 },
        ],
      }),
    );
    expect([...memory]).toEqual([["shop/web", 15]]);
  });
});

describe("sortPods", () => {
  it("puts pods that need attention first", () => {
    const sorted = sortPods([
      podFixture({ name: "b" }),
      podFixture({ name: "a" }),
      podFixture({ name: "z", problem: "Error" }),
    ]);
    expect(sorted.map((pod) => pod.name)).toEqual(["z", "a", "b"]);
  });
});

describe("cluster summaries", () => {
  it("counts what each tab shows in a namespace", () => {
    expect(tabCounts(clusterFixture(), "shop")).toEqual({
      pods: 2,
      deployments: 1,
      services: 2,
      ingress: 1,
      config: 2,
    });
  });

  it("finds crash-looping pods", () => {
    expect(crashing(clusterFixture()).map((pod) => pod.name)).toEqual(["checkout-7d9f-x2"]);
    expect(crashing(undefined)).toEqual([]);
  });

  it("reads tabs and versions", () => {
    expect(asTab("services")).toBe("services");
    expect(asTab("nonsense")).toBe("pods");
    expect(asTab(undefined)).toBe("pods");
    expect(k3sVersion("v1.35.0+k3s1")).toBe("1.35.0");
  });
});
