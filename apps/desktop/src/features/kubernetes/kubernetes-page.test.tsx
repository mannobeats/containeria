import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { engineFixture, metricsFixture } from "@/test/fixtures";
import { mockCommands, renderWithApp } from "@/test/harness";
import { clusterFixture } from "@/test/kube-fixtures";

import { KubernetesPage } from "./kubernetes-page";

const on = engineFixture();
on.config.kubernetes.enabled = true;

function setup({ enabled = true, url = "/kubernetes" } = {}) {
  const calls = mockCommands({
    engineStatus: () => (enabled ? on : engineFixture()),
    kubernetesCluster: () => clusterFixture(),
    containersList: () => [],
    metricsLatest: () => metricsFixture(),
    kubernetesConfigValue: () => "hunter2",
    kubernetesApply: () => ["deployments/web configured"],
  });
  renderWithApp(<KubernetesPage />, { route: "/kubernetes", url });
  return calls;
}

const called = (calls: ReturnType<typeof setup>, command: string) =>
  waitFor(() => expect(calls.map((call) => call.command)).toContain(command));

describe("KubernetesPage", () => {
  it("offers to turn Kubernetes on when it's off", async () => {
    const calls = setup({ enabled: false });
    await userEvent.click(await screen.findByRole("button", { name: "Turn on Kubernetes" }));
    await waitFor(() =>
      expect(calls).toContainEqual(
        expect.objectContaining({
          command: "kubernetesSetEnabled",
          args: expect.objectContaining({ enabled: true }),
        }),
      ),
    );
  });

  it("lists pods with the failing one first and a banner about it", async () => {
    setup();
    const rows = await screen.findAllByRole("row");
    expect(rows[1]?.textContent).toContain("checkout-7d9f-x2");
    expect(screen.getByRole("alert").textContent).toContain("CrashLoopBackOff, 14 restarts");
    expect(screen.getByText("k3s 1.35.0")).toBeDefined();
  });

  it("filters by namespace and search", async () => {
    setup();
    await userEvent.click(await screen.findByRole("button", { name: /All namespaces/ }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "kube-system" }));
    const table = () => screen.queryByRole("table", { name: "Pods" });
    expect(table()?.textContent).toContain("coredns-ccb9");
    expect(table()?.textContent).not.toContain("checkout-7d9f-x2");
    await userEvent.type(screen.getByPlaceholderText("Filter"), "nothing-matches");
    expect(table()?.textContent).not.toContain("coredns-ccb9");
  });

  it("shows services with their localhost address", async () => {
    setup({ url: "/kubernetes?tab=services" });
    expect(await screen.findByRole("button", { name: /localhost:8080/ })).toBeDefined();
    expect(screen.getByText("orders-db.shop.svc")).toBeDefined();
  });

  it("scales and restarts a deployment", async () => {
    const calls = setup({ url: "/kubernetes?tab=deployments" });
    await userEvent.click(
      await screen.findByRole("button", { name: "Rollout restart storefront" }),
    );
    await called(calls, "kubernetesRestartDeployment");
    await userEvent.click(screen.getByRole("button", { name: "Scale storefront" }));
    await userEvent.click(await screen.findByRole("button", { name: "Scale" }));
    await called(calls, "kubernetesScaleDeployment");
  });

  it("reveals a secret value only when asked", async () => {
    const calls = setup({ url: "/kubernetes?tab=config" });
    await userEvent.click(await screen.findByRole("button", { name: /db-credentials/ }));
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByText("••••••••••••")).toBeDefined();
    expect(calls.map((call) => call.command)).not.toContain("kubernetesConfigValue");
    await userEvent.click(within(sheet).getByRole("button", { name: "Reveal password" }));
    expect(await within(sheet).findByText("hunter2")).toBeDefined();
  });

  it("applies a manifest", async () => {
    const calls = setup();
    await userEvent.click(await screen.findByRole("button", { name: "Apply YAML" }));
    await userEvent.click(await screen.findByRole("button", { name: "Apply" }));
    await called(calls, "kubernetesApply");
  });

  it("asks before resetting the cluster", async () => {
    const calls = setup();
    await userEvent.click(await screen.findByRole("button", { name: "Cluster" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Reset cluster…" }));
    await userEvent.click(await screen.findByRole("button", { name: "Reset cluster" }));
    await called(calls, "kubernetesReset");
  });

  it("asks before turning Kubernetes off", async () => {
    const calls = setup();
    await userEvent.click(await screen.findByRole("switch", { name: "Kubernetes" }));
    await userEvent.click(await screen.findByRole("button", { name: "Turn off" }));
    await called(calls, "kubernetesSetEnabled");
  });

  it("deletes a pod from its menu", async () => {
    const calls = setup();
    await userEvent.click(await screen.findByRole("button", { name: "More for checkout-7d9f-x2" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Delete pod…" }));
    await userEvent.click(await screen.findByRole("button", { name: "Delete pod" }));
    await called(calls, "kubernetesDeletePod");
  });
});
