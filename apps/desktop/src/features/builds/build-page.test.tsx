import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import type { BuildDetail } from "@/lib/ipc/bindings";
import { buildFixture, engineFixture, imageFixture } from "@/test/fixtures";
import { mockCommands, renderWithApp, sendToChannel } from "@/test/harness";

import { BuildPage } from "./build-page";

const route = (tab = "") => ({ path: "builds/$id", url: `/builds/b1${tab}` });

function detailFixture(overrides: Partial<BuildDetail> = {}): BuildDetail {
  return {
    id: "b1",
    name: "shop (api)",
    dockerfile: "docker/api.Dockerfile",
    context: "/Users/ada/shop",
    target: null,
    platforms: ["linux/arm64"],
    vcsRepository: null,
    vcsRevision: null,
    buildArgs: [{ key: "NODE_ENV", value: "production" }],
    labels: [],
    error: null,
    imageId: "sha256:api",
    ...overrides,
  };
}

function setup(record = buildFixture({ id: "b1" }), detail = detailFixture(), tab = "") {
  const calls = mockCommands({
    engineStatus: () => engineFixture(),
    buildsList: () => [record],
    buildDetail: () => detail,
    imagesList: () => [imageFixture({ id: "sha256:api", references: ["shop-api:dev"] })],
    buildLogs: (args) => {
      queueMicrotask(() => {
        sendToChannel(args.channel, { kind: "line", text: "#5 [2/4] RUN npm ci" });
        sendToChannel(args.channel, { kind: "line", text: "#5 0.4 added 210 packages" });
      });
      return 3;
    },
  });
  const { router } = renderWithApp(<BuildPage />, { route: route(tab) });
  return { calls, router };
}

describe("BuildPage", () => {
  it("follows a running build's output with its progress", async () => {
    const running = buildFixture({
      id: "b1",
      status: "running",
      completedAtMs: null,
      totalSteps: 0,
    });
    const { calls } = setup(running);
    const log = await screen.findByRole("log", { name: "Output of shop (api)" });
    await waitFor(() => expect(log.textContent).toContain("added 210 packages"));
    expect(screen.getByRole("progressbar", { name: "shop (api) progress" })).toBeDefined();
    expect(calls.find((call) => call.command === "buildLogs")?.args.id).toBe("b1");
  });

  it("shows why a failed build broke above its output", async () => {
    setup(
      buildFixture({ id: "b1", status: "failed" }),
      detailFixture({
        error: {
          step: "[2/2] RUN exit 3",
          message: "process did not complete successfully: exit code: 3",
          logs: ["about to fail"],
        },
      }),
    );
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("[2/2] RUN exit 3");
    expect(alert.textContent).toContain("exit code: 3");
    expect(alert.textContent).toContain("about to fail");
  });

  it("lists what the build was asked for and links the image it made", async () => {
    setup(buildFixture({ id: "b1" }), detailFixture(), "?tab=info");
    expect(await screen.findByText("docker/api.Dockerfile")).toBeDefined();
    expect(screen.getByText("NODE_ENV=production")).toBeDefined();
    expect(screen.getByText("linux/arm64")).toBeDefined();
    expect((await screen.findByRole("link", { name: "shop-api:dev" })).getAttribute("href")).toBe(
      "/images/sha256%3Aapi",
    );
  });

  it("doesn't call the image gone before the images have loaded", async () => {
    mockCommands({
      engineStatus: () => engineFixture({ phase: "stopped" }),
      buildDetail: () => detailFixture(),
    });
    renderWithApp(<BuildPage />, { route: route("?tab=info") });
    expect(await screen.findByText("docker/api.Dockerfile")).toBeDefined();
    expect(screen.queryByText("No longer on this engine")).toBeNull();
  });

  it("removes the build from the history and goes back to the list", async () => {
    const { calls, router } = setup();
    await userEvent.click(await screen.findByRole("button", { name: "More for shop (api)" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Remove from History" }));
    await waitFor(() =>
      expect(calls).toContainEqual({ command: "buildRemove", args: { id: "b1" } }),
    );
    await waitFor(() => expect(router.state.location.pathname).toBe("/builds"));
  });

  it("says when the build is no longer in the history", async () => {
    mockCommands({
      engineStatus: () => engineFixture(),
      buildsList: () => [],
      buildDetail: () => {
        throw { kind: "notFound", message: "That build was not found" };
      },
    });
    renderWithApp(<BuildPage />, { route: route() });
    expect(await screen.findByText("This build isn't in the history")).toBeDefined();
  });
});
