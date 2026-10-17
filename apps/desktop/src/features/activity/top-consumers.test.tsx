import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderWithApp } from "@/test/harness";

import { TopConsumers } from "./top-consumers";

const consumer = {
  image: "nginx:alpine",
  group: "Standalone",
  cpuPercent: 0.4,
  memoryBytes: 64 * 1024 ** 2,
};

describe("TopConsumers", () => {
  it("opens a pod's page for its container and a container's page otherwise", async () => {
    renderWithApp(
      <TopConsumers
        consumers={[
          { ...consumer, id: "a", name: "web-7d9", pod: "default/web-7d9", group: "Kubernetes" },
          { ...consumer, id: "b", name: "proxy", pod: null },
        ]}
      />,
    );
    expect((await screen.findByRole("link", { name: "web-7d9" })).getAttribute("href")).toBe(
      "/kubernetes/pods/default/web-7d9",
    );
    expect(screen.getByRole("link", { name: "proxy" }).getAttribute("href")).toBe("/containers/b");
  });
});
