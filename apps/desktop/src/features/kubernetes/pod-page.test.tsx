import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { afterEach, describe, expect, it, vi } from "vitest";

import { terminals } from "@/test/canvas-mocks";
import { engineFixture, metricsFixture } from "@/test/fixtures";
import { type Call, mockCommands, renderWithApp, sendToChannel } from "@/test/harness";
import { clusterFixture, podFixture } from "@/test/kube-fixtures";

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

const sidecars = podFixture({ name: "api-5c8d-q1", containers: ["api", "envoy"] });

afterEach(() => vi.restoreAllMocks());

const commandsOf = (calls: Call[]) => calls.map((call) => call.command);

type Overrides = Parameters<typeof mockCommands>[0];

function setup(url: string, overrides: Overrides = {}) {
  const calls = mockCommands({
    engineStatus: () => on,
    kubernetesCluster: () => clusterFixture({ pods: [...clusterFixture().pods, sidecars] }),
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
    kubernetesShell: (args) => {
      queueMicrotask(() => sendToChannel(args.channel, { kind: "output", text: "/app # " }));
      return 5;
    },
    ...overrides,
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
    const logs = calls.find((call) => call.command === "kubernetesLogs");
    act(() => sendToChannel(logs?.args.channel, "listening on :8080"));
    expect(screen.getByRole("log", { name: "Logs of checkout-7d9f-x2" }).textContent).toContain(
      "listening on :8080",
    );
  });

  it("follows the container picked from a pod with several", async () => {
    const calls = setup("/kubernetes/pods/shop/api-5c8d-q1");
    const picker = await screen.findByRole("combobox", { name: "Container" });
    const logsOf = (container: string) =>
      expect(calls).toContainEqual(
        expect.objectContaining({
          command: "kubernetesLogs",
          args: expect.objectContaining({ pod: "api-5c8d-q1", container }),
        }),
      );
    await waitFor(() => logsOf("api"));
    await userEvent.selectOptions(picker, "envoy");
    await waitFor(() => logsOf("envoy"));
  });

  it("opens a newly picked container's log at its end, even after scrolling up", async () => {
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(1000);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(200);
    setup("/kubernetes/pods/shop/api-5c8d-q1");
    const picker = await screen.findByRole("combobox", { name: "Container" });
    const before = screen.getByRole("log", { name: "Logs of api-5c8d-q1" });
    before.scrollTop = 100;
    fireEvent.scroll(before);
    await userEvent.selectOptions(picker, "envoy");
    await waitFor(() =>
      expect(screen.getByRole("log", { name: "Logs of api-5c8d-q1" }).scrollTop).toBe(1000),
    );
  });

  it("marks warning events in words, not only in red", async () => {
    setup("/kubernetes/pods/shop/checkout-7d9f-x2?tab=events");
    const event = await screen.findByRole("listitem");
    expect(event.textContent).toContain("Warning: BackOff");
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

  it("says when a forward didn't stop", async () => {
    forwards = [forward];
    const error = vi.spyOn(toast, "error");
    setup("/kubernetes/pods/shop/checkout-7d9f-x2", {
      kubernetesStopForward: () => {
        throw { kind: "internal", message: "No such stream" };
      },
    });
    await userEvent.click(
      await screen.findByRole("button", { name: "Stop forwarding localhost:8080" }),
    );
    await waitFor(() =>
      expect(error).toHaveBeenCalledWith("The forward didn't stop", {
        description: "No such stream",
      }),
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

  async function openTerminal(): Promise<Call[]> {
    const calls = setup("/kubernetes/pods/shop/storefront-6f9c-abcde?tab=terminal");
    await waitFor(() => expect(terminals.at(-1)?.written).toBe("/app # "));
    return calls;
  }

  it("opens a terminal in a pod with one container", async () => {
    const calls = await openTerminal();
    expect(calls).toContainEqual(
      expect.objectContaining({
        command: "kubernetesShell",
        args: expect.objectContaining({
          namespace: "shop",
          pod: "storefront-6f9c-abcde",
          container: null,
        }),
      }),
    );
    expect(screen.queryByRole("combobox", { name: "Container" })).toBeNull();
  });

  it("sends what's typed and the terminal size to the pod", async () => {
    const calls = await openTerminal();
    const terminal = terminals.at(-1);
    act(() => {
      terminal?.type("ls\r");
      terminal?.resize(100, 30);
    });
    await waitFor(() => {
      expect(calls).toContainEqual({ command: "shellInput", args: { stream: 5, text: "ls\r" } });
      expect(calls).toContainEqual({
        command: "shellResize",
        args: { stream: 5, cols: 100, rows: 30 },
      });
    });
  });

  it("reconnects the terminal after the shell exits", async () => {
    const calls = await openTerminal();
    const shell = calls.find((call) => call.command === "kubernetesShell");
    act(() => sendToChannel(shell?.args.channel, { kind: "closed" }));
    await userEvent.click(await screen.findByRole("button", { name: "Reconnect" }));
    await waitFor(() =>
      expect(calls.filter((call) => call.command === "kubernetesShell")).toHaveLength(2),
    );
    expect(calls).toContainEqual({ command: "streamCancel", args: { id: 5 } });
  });

  it("picks the container when the pod has several", async () => {
    const calls = setup("/kubernetes/pods/shop/api-5c8d-q1?tab=terminal");
    const picker = await screen.findByRole("combobox", { name: "Container" });
    await waitFor(() =>
      expect(calls).toContainEqual(
        expect.objectContaining({
          command: "kubernetesShell",
          args: expect.objectContaining({ container: "api" }),
        }),
      ),
    );
    await userEvent.selectOptions(picker, "envoy");
    await waitFor(() =>
      expect(calls).toContainEqual(
        expect.objectContaining({
          command: "kubernetesShell",
          args: expect.objectContaining({ container: "envoy" }),
        }),
      ),
    );
  });

  it("opens the terminal from the pod menu", async () => {
    setup("/kubernetes/pods/shop/storefront-6f9c-abcde");
    await userEvent.click(
      await screen.findByRole("button", { name: "More for storefront-6f9c-abcde" }),
    );
    await userEvent.click(await screen.findByRole("menuitem", { name: "Terminal" }));
    expect(
      await screen.findByRole("region", { name: "Terminal in storefront-6f9c-abcde" }),
    ).toBeDefined();
  });

  it("explains why a pod that isn't running has no terminal", async () => {
    setup("/kubernetes/pods/shop/checkout-7d9f-x2?tab=terminal");
    expect(
      await screen.findByRole("heading", { name: "checkout-7d9f-x2 isn't running" }),
    ).toBeDefined();
  });

  it("says when Kubernetes isn't running instead of showing a blank page", async () => {
    const calls = setup("/kubernetes/pods/shop/checkout-7d9f-x2", {
      kubernetesCluster: () => {
        throw { kind: "kubernetesUnavailable", message: "k3s isn't answering" };
      },
    });
    expect(await screen.findByRole("heading", { name: "Kubernetes isn't running" })).toBeDefined();
    expect(commandsOf(calls)).not.toContain("kubernetesLogs");
  });

  it("says when the pod is gone", async () => {
    setup("/kubernetes/pods/shop/replaced-pod");
    expect(await screen.findByRole("heading", { name: "replaced-pod is gone" })).toBeDefined();
  });
});
