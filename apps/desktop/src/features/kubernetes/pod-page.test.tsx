import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { engineFixture, metricsFixture } from "@/test/fixtures";
import { mockCommands, renderWithApp } from "@/test/harness";
import { clusterFixture } from "@/test/kube-fixtures";

import { PodPage } from "./pod-page";

const on = engineFixture();
on.config.kubernetes.enabled = true;

const forward = {
  stream: 8,
  namespace: "shop",
  pod: "checkout-7d9f-x2",
  localPort: 8080,
  podPort: 8080,
};
let forwards = [forward];

function setup(url: string) {
  const calls = mockCommands({
    engineStatus: () => on,
    kubernetesCluster: () => clusterFixture(),
    containersList: () => [],
    metricsLatest: () => metricsFixture(),
    kubernetesLogs: () => 7,
    kubernetesEvents: () => [
      {
        warning: true,
        reason: "BackOff",
        message: "Back-off restarting failed container",
        count: 9,
        lastSeen: 1_792_000_000,
      },
    ],
    kubernetesYaml: () => "apiVersion: v1\nkind: Pod\n",
    kubernetesPortForward: () => forward,
    kubernetesForwards: () => forwards,
  });
  renderWithApp(<PodPage />, { route: { path: "/kubernetes/pods/$namespace/$name", url } });
  return calls;
}

describe("PodPage", () => {
  it("follows the pod's logs", async () => {
    const calls = setup("/kubernetes/pods/shop/checkout-7d9f-x2");
    expect(await screen.findByRole("heading", { name: "checkout-7d9f-x2" })).toBeDefined();
    await waitFor(() =>
      expect(calls).toContainEqual(
        expect.objectContaining({
          command: "kubernetesLogs",
          args: expect.objectContaining({ pod: "checkout-7d9f-x2" }),
        }),
      ),
    );
    expect(screen.getByRole("log", { name: "Logs of checkout-7d9f-x2" })).toBeDefined();
  });

  it("shows events with warnings", async () => {
    setup("/kubernetes/pods/shop/checkout-7d9f-x2?tab=events");
    expect(await screen.findByText("BackOff")).toBeDefined();
    expect(screen.getByText("×9")).toBeDefined();
  });

  it("shows the pod as YAML", async () => {
    setup("/kubernetes/pods/shop/checkout-7d9f-x2?tab=yaml");
    expect(await screen.findByRole("button", { name: "Edit and apply" })).toBeDefined();
  });

  it("forwards a port", async () => {
    const calls = setup("/kubernetes/pods/shop/checkout-7d9f-x2");
    await userEvent.click(await screen.findByRole("button", { name: "Port forward" }));
    await userEvent.click(await screen.findByRole("button", { name: "Forward" }));
    await waitFor(() =>
      expect(calls).toContainEqual(
        expect.objectContaining({
          command: "kubernetesPortForward",
          args: expect.objectContaining({ localPort: 8080 }),
        }),
      ),
    );
  });

  it("lists running forwards and stops one", async () => {
    forwards = [forward];
    const calls = setup("/kubernetes/pods/shop/checkout-7d9f-x2");
    await userEvent.click(
      await screen.findByRole("button", { name: "Stop forwarding localhost:8080" }),
    );
    await waitFor(() =>
      expect(calls).toContainEqual({ command: "kubernetesStopForward", args: { stream: 8 } }),
    );
  });

  it("stops a forward from its right-click menu", async () => {
    forwards = [forward];
    const calls = setup("/kubernetes/pods/shop/checkout-7d9f-x2");
    fireEvent.contextMenu(await screen.findByText(/localhost:8080/));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Stop Forwarding" }));
    await waitFor(() =>
      expect(calls).toContainEqual({ command: "kubernetesStopForward", args: { stream: 8 } }),
    );
  });

  it("says when the pod is gone", async () => {
    setup("/kubernetes/pods/shop/replaced-pod");
    expect(await screen.findByRole("heading", { name: "replaced-pod is gone" })).toBeDefined();
  });
});
