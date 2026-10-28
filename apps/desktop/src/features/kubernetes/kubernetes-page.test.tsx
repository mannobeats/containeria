import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import type { Cluster } from "@/lib/ipc/bindings";
import { engineFixture, metricsFixture } from "@/test/fixtures";
import { type Call, mockCommands, renderWithApp } from "@/test/harness";
import { clusterFixture } from "@/test/kube-fixtures";

import { KubernetesPage } from "./kubernetes-page";

const on = engineFixture();
on.config.kubernetes.enabled = true;

const storefrontYaml = (replicas: number) =>
  `apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: storefront\nspec:\n  replicas: ${replicas}\n`;

type Setup = {
  enabled?: boolean;
  url?: string;
  cluster?: () => Cluster;
  yaml?: () => string;
  configValue?: () => string;
};

function setup({
  enabled = true,
  url = "/kubernetes",
  cluster = () => clusterFixture(),
  yaml = () => storefrontYaml(3),
  configValue = () => "hunter2",
}: Setup = {}) {
  const calls = mockCommands({
    engineStatus: () => (enabled ? on : engineFixture()),
    kubernetesCluster: cluster,
    containersList: () => [],
    metricsLatest: () => metricsFixture(),
    kubernetesConfigValue: configValue,
    kubernetesApply: () => ["deployments/web configured"],
    kubernetesYaml: yaml,
    kubernetesKubeconfigPath: () => "/Users/ada/.kube/config",
  });
  renderWithApp(<KubernetesPage />, { route: { path: "/kubernetes", url } });
  return calls;
}

const sent = (calls: Call[], command: Call["command"], args: Record<string, unknown>) =>
  waitFor(() =>
    expect(calls).toContainEqual(
      expect.objectContaining({ command, args: expect.objectContaining(args) }),
    ),
  );

const commandsOf = (calls: Call[]) => calls.map((call) => call.command);

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

  it("filters by namespace", async () => {
    setup();
    await userEvent.click(await screen.findByRole("button", { name: /All namespaces/ }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "kube-system" }));
    const table = screen.getByRole("table", { name: "Pods" });
    expect(table.textContent).toContain("coredns-ccb9");
    expect(table.textContent).not.toContain("checkout-7d9f-x2");
  });

  it("filters by search", async () => {
    setup();
    const table = await screen.findByRole("table", { name: "Pods" });
    await userEvent.type(screen.getByPlaceholderText("Filter"), "coredns");
    expect(table.textContent).toContain("coredns-ccb9");
    expect(table.textContent).not.toContain("checkout-7d9f-x2");
  });

  it("offers to turn Kubernetes off while k3s doesn't come up", async () => {
    const calls = setup({
      cluster: () => {
        throw { kind: "kubernetesUnavailable", message: "k3s isn't answering" };
      },
    });
    expect(await screen.findByRole("heading", { name: "Starting Kubernetes" })).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: "Turn off Kubernetes" }));
    await sent(calls, "kubernetesSetEnabled", { enabled: false });
  });

  it("shows services with their localhost address", async () => {
    setup({ url: "/kubernetes?tab=services" });
    expect(await screen.findByRole("button", { name: /localhost:8080/ })).toBeDefined();
    expect(screen.getByText("orders-db.shop.svc")).toBeDefined();
  });

  it("restarts a deployment", async () => {
    const calls = setup({ url: "/kubernetes?tab=deployments" });
    await userEvent.click(
      await screen.findByRole("button", { name: "Rollout restart storefront" }),
    );
    await waitFor(() =>
      expect(calls).toContainEqual({
        command: "kubernetesRestartDeployment",
        args: { namespace: "shop", name: "storefront" },
      }),
    );
  });

  it("scales a deployment", async () => {
    const calls = setup({ url: "/kubernetes?tab=deployments" });
    await userEvent.click(await screen.findByRole("button", { name: "Scale storefront" }));
    fireEvent.change(await screen.findByRole("slider"), { target: { value: "5" } });
    await userEvent.click(screen.getByRole("button", { name: "Scale" }));
    await waitFor(() =>
      expect(calls).toContainEqual({
        command: "kubernetesScaleDeployment",
        args: { namespace: "shop", name: "storefront", replicas: 5 },
      }),
    );
  });

  it("scales past ten replicas from a deployment that already has more", async () => {
    const big = clusterFixture();
    big.deployments = big.deployments.map((deployment) => ({ ...deployment, desired: 15 }));
    setup({ url: "/kubernetes?tab=deployments", cluster: () => big });
    await userEvent.click(await screen.findByRole("button", { name: "Scale storefront" }));
    const slider = await screen.findByRole("slider");
    expect(slider).toHaveProperty("value", "15");
    fireEvent.change(slider, { target: { value: "12" } });
    expect(slider).toHaveProperty("value", "12");
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

  it("says why a value couldn't be read", async () => {
    setup({
      url: "/kubernetes?tab=config",
      configValue: () => {
        throw { kind: "kubernetes", message: 'secrets "db-credentials" not found' };
      },
    });
    await userEvent.click(await screen.findByRole("button", { name: /db-credentials/ }));
    const sheet = await screen.findByRole("dialog", { name: "db-credentials" });
    await userEvent.click(within(sheet).getByRole("button", { name: "Reveal password" }));
    expect(await within(sheet).findByText('secrets "db-credentials" not found')).toBeDefined();
  });

  it("applies a manifest", async () => {
    const calls = setup();
    await userEvent.click(await screen.findByRole("button", { name: "Apply YAML" }));
    await userEvent.click(await screen.findByRole("button", { name: "Apply" }));
    await sent(calls, "kubernetesApply", { namespace: "default", dryRun: false });
  });

  it("asks before resetting the cluster", async () => {
    const calls = setup();
    await userEvent.click(await screen.findByRole("button", { name: "Cluster" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Reset Cluster…" }));
    const confirm = await screen.findByRole("button", { name: "Reset cluster" });
    expect(commandsOf(calls)).not.toContain("kubernetesReset");
    await userEvent.click(confirm);
    await waitFor(() => expect(commandsOf(calls)).toContain("kubernetesReset"));
  });

  it("asks before turning Kubernetes off", async () => {
    const calls = setup();
    await userEvent.click(await screen.findByRole("switch", { name: "Kubernetes" }));
    const confirm = await screen.findByRole("button", { name: "Turn off" });
    expect(commandsOf(calls)).not.toContain("kubernetesSetEnabled");
    await userEvent.click(confirm);
    await sent(calls, "kubernetesSetEnabled", { enabled: false });
  });

  it("deletes a pod from its menu after asking", async () => {
    const calls = setup();
    await userEvent.click(await screen.findByRole("button", { name: "More for checkout-7d9f-x2" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Delete Pod…" }));
    const confirm = await screen.findByRole("button", { name: "Delete pod" });
    expect(commandsOf(calls)).not.toContain("kubernetesDeletePod");
    await userEvent.click(confirm);
    await waitFor(() =>
      expect(calls).toContainEqual({
        command: "kubernetesDeletePod",
        args: { namespace: "shop", name: "checkout-7d9f-x2" },
      }),
    );
  });

  it("deletes a pod from its right-click menu", async () => {
    const calls = setup();
    fireEvent.contextMenu(await screen.findByRole("row", { name: /checkout-7d9f-x2/ }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Delete Pod…" }));
    await userEvent.click(await screen.findByRole("button", { name: "Delete pod" }));
    await waitFor(() =>
      expect(calls).toContainEqual({
        command: "kubernetesDeletePod",
        args: { namespace: "shop", name: "checkout-7d9f-x2" },
      }),
    );
  });

  it("deletes a deployment from its menu", async () => {
    const calls = setup({ url: "/kubernetes?tab=deployments" });
    fireEvent.contextMenu(await screen.findByRole("row", { name: /storefront/ }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Delete Deployment…" }));
    await userEvent.click(await screen.findByRole("button", { name: "Delete deployment" }));
    await waitFor(() =>
      expect(calls).toContainEqual({
        command: "kubernetesDeleteDeployment",
        args: { namespace: "shop", name: "storefront" },
      }),
    );
  });

  it("restarts a deployment from its right-click menu", async () => {
    const calls = setup({ url: "/kubernetes?tab=deployments" });
    fireEvent.contextMenu(await screen.findByRole("row", { name: /storefront/ }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Restart Rollout" }));
    await waitFor(() =>
      expect(calls).toContainEqual({
        command: "kubernetesRestartDeployment",
        args: { namespace: "shop", name: "storefront" },
      }),
    );
  });

  it("copies a service address from its right-click menu", async () => {
    const calls = setup({ url: "/kubernetes?tab=services" });
    fireEvent.contextMenu(await screen.findByRole("row", { name: /orders-db/ }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Copy Address" }));
    await waitFor(() =>
      expect(calls).toContainEqual(
        expect.objectContaining({ args: expect.objectContaining({ text: "orders-db.shop.svc" }) }),
      ),
    );
  });

  it("opens a config map from its right-click menu", async () => {
    setup({ url: "/kubernetes?tab=config" });
    fireEvent.contextMenu(await screen.findByRole("row", { name: /db-credentials/ }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Open" }));
    const sheet = await screen.findByRole("dialog", { name: "db-credentials" });
    expect(within(sheet).getByText("password")).toBeDefined();
  });

  it("creates a namespace from the namespace menu, refusing invalid names", async () => {
    const calls = setup();
    await userEvent.click(await screen.findByRole("button", { name: /All namespaces/ }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "New Namespace…" }));
    const sheet = await screen.findByRole("dialog");
    const name = within(sheet).getByRole("textbox", { name: "Name" });
    await userEvent.type(name, "Shop_DB");
    await userEvent.click(within(sheet).getByRole("button", { name: "Create" }));
    expect(within(sheet).getByText(/^Use lowercase letters/)).toBeDefined();
    expect(calls.map((call) => call.command)).not.toContain("kubernetesCreateNamespace");
    await userEvent.clear(name);
    await userEvent.type(name, "staging");
    await userEvent.click(within(sheet).getByRole("button", { name: "Create" }));
    await waitFor(() =>
      expect(calls).toContainEqual({
        command: "kubernetesCreateNamespace",
        args: { name: "staging" },
      }),
    );
  });

  it("opens the new namespace sheet from the cluster menu", async () => {
    setup();
    await userEvent.click(await screen.findByRole("button", { name: "Cluster" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "New Namespace…" }));
    expect(await screen.findByRole("dialog", { name: "New namespace" })).toBeDefined();
  });

  it("copies the kubeconfig path", async () => {
    const calls = setup();
    await userEvent.click(await screen.findByRole("button", { name: "Cluster" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Copy kubeconfig Path" }));
    await waitFor(() =>
      expect(calls).toContainEqual(
        expect.objectContaining({
          args: expect.objectContaining({ text: "/Users/ada/.kube/config" }),
        }),
      ),
    );
  });

  it("edits a deployment's YAML and applies it", async () => {
    const calls = setup({ url: "/kubernetes?tab=deployments" });
    fireEvent.contextMenu(await screen.findByRole("row", { name: /storefront/ }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Edit YAML…" }));
    await waitFor(() =>
      expect(calls).toContainEqual({
        command: "kubernetesYaml",
        args: { kind: "deployment", namespace: "shop", name: "storefront" },
      }),
    );
    const sheet = await screen.findByRole("dialog", { name: "Apply YAML" });
    await userEvent.click(within(sheet).getByRole("button", { name: "Apply" }));
    await waitFor(() =>
      expect(calls).toContainEqual(
        expect.objectContaining({
          command: "kubernetesApply",
          args: expect.objectContaining({ manifest: expect.stringContaining("name: storefront") }),
        }),
      ),
    );
  });

  it("edits the deployment as it is now, not as it was when last edited", async () => {
    let replicas = 3;
    const calls = setup({
      url: "/kubernetes?tab=deployments",
      yaml: () => storefrontYaml(replicas),
    });
    const edit = async () => {
      fireEvent.contextMenu(await screen.findByRole("row", { name: /storefront/ }));
      await userEvent.click(await screen.findByRole("menuitem", { name: "Edit YAML…" }));
      return screen.findByRole("dialog", { name: "Apply YAML" });
    };
    await userEvent.click(within(await edit()).getByRole("button", { name: "Cancel" }));
    replicas = 5;
    await userEvent.click(within(await edit()).getByRole("button", { name: "Apply" }));
    await sent(calls, "kubernetesApply", { manifest: storefrontYaml(5) });
  });
});
