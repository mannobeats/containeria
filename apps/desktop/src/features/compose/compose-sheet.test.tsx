import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { mockCommands, renderWithApp, sendToChannel } from "@/test/harness";

import { ComposeRunSheet } from "./compose-run-sheet";
import { ComposeSheet } from "./compose-sheet";
import { fileDraft, newDraft } from "./model";
import { useCompose } from "./store";

const sheets = (
  <>
    <ComposeSheet />
    <ComposeRunSheet />
  </>
);

let channel: unknown;

function setup() {
  const calls = mockCommands({
    composePreview: () => ({
      name: "project",
      services: [{ name: "web", image: "nginx:1.29", builds: false, ports: ["8080:80"] }],
    }),
    composeDeploy: (args) => {
      channel = args.channel;
      return 7;
    },
    composeAct: (args) => {
      channel = args.channel;
      return 8;
    },
  });
  return calls;
}

beforeEach(() => {
  channel = undefined;
  useCompose.setState({ draft: null, run: null, runVisible: false });
});

describe("ComposeSheet", () => {
  it("checks pasted YAML, then deploys it and shows Compose's output", async () => {
    const calls = setup();
    useCompose.getState().edit(newDraft());
    renderWithApp(sheets);
    const deploy = await screen.findByRole("button", { name: "Deploy" });
    expect(deploy.hasAttribute("disabled")).toBe(true);
    await userEvent.click(screen.getByRole("button", { name: "Check" }));
    expect(await screen.findByText("nginx:1.29")).toBeDefined();
    await userEvent.clear(screen.getByLabelText("Project name"));
    await userEvent.type(screen.getByLabelText("Project name"), "shop");
    await userEvent.click(screen.getByRole("button", { name: "Deploy" }));
    await waitFor(() =>
      expect(calls).toContainEqual(
        expect.objectContaining({
          command: "composeDeploy",
          args: expect.objectContaining({
            name: "shop",
            source: expect.objectContaining({ kind: "text" }),
          }),
        }),
      ),
    );
    sendToChannel(channel, { kind: "line", text: "Container shop-web-1 Started" });
    expect(await screen.findByText("Container shop-web-1 Started")).toBeDefined();
    sendToChannel(channel, { kind: "done" });
    expect(await screen.findByText("shop is up")).toBeDefined();
  });

  it("refuses a name Compose wouldn't take", async () => {
    setup();
    useCompose.getState().edit(newDraft());
    renderWithApp(sheets);
    await userEvent.type(await screen.findByLabelText("Project name"), "My Shop");
    expect(screen.getByRole("alert").textContent).toContain("lowercase");
    expect(screen.getByRole("button", { name: "Deploy" }).hasAttribute("disabled")).toBe(true);
  });

  it("saves an edited file before deploying it", async () => {
    const calls = setup();
    useCompose.getState().edit({
      ...fileDraft("/Users/ada/shop/compose.yaml", "services: {}"),
      text: "services: {web: {image: nginx}}",
    });
    renderWithApp(sheets);
    await userEvent.click(await screen.findByRole("button", { name: "Save and Deploy" }));
    await waitFor(() =>
      expect(calls).toContainEqual(
        expect.objectContaining({
          command: "composeDeploy",
          args: expect.objectContaining({
            name: "shop",
            source: {
              kind: "file",
              path: "/Users/ada/shop/compose.yaml",
              text: "services: {web: {image: nginx}}",
            },
          }),
        }),
      ),
    );
  });

  it("offers to edit the file when a deploy fails", async () => {
    const calls = setup();
    useCompose.getState().edit({ ...newDraft(), name: "shop" });
    renderWithApp(sheets);
    await userEvent.click(await screen.findByRole("button", { name: "Deploy" }));
    await waitFor(() => expect(calls.map((call) => call.command)).toContain("composeDeploy"));
    sendToChannel(channel, { kind: "failed", message: "port 8080 is already allocated" });
    expect(await screen.findByText("port 8080 is already allocated")).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: "Edit File" }));
    expect(await screen.findByRole("dialog", { name: "Deploy a Compose project" })).toBeDefined();
  });
});
