import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { containerFixture, engineFixture } from "@/test/fixtures";
import { mockCommands, renderWithApp } from "@/test/harness";

import { useRunSheet } from "./api";
import { RunSheet } from "./run-sheet";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(() => Promise.resolve("/Users/ada/site")),
}));

function setup(run: () => string = () => "new-id") {
  const calls = mockCommands({
    engineStatus: () => engineFixture(),
    containersList: () => [
      containerFixture({ name: "db", ports: [{ container: 5432, host: 8080, protocol: "tcp" }] }),
    ],
    hubSearch: () => [
      { name: "nginx", description: "Official build of Nginx.", official: true, stars: 21_000 },
      { name: "bitnami/nginx", description: "Bitnami", official: false, stars: 200 },
    ],
    containerRun: run,
  });
  renderWithApp(<RunSheet />);
  act(() => useRunSheet.getState().show());
  return calls;
}

describe("RunSheet", () => {
  it("asks for an image before running", async () => {
    const calls = setup();
    await userEvent.click(await screen.findByRole("button", { name: /^Run/ }));
    expect(await screen.findByText("Choose an image to run.")).toBeDefined();
    expect(calls.map((call) => call.command)).not.toContain("containerRun");
  });

  it("searches Docker Hub and runs the picked image with ports, variables and storage", async () => {
    const calls = setup();
    await userEvent.type(await screen.findByRole("textbox", { name: "Image" }), "ngi");
    await userEvent.click(await screen.findByRole("option", { name: /nginx Official/ }));
    await userEvent.click(screen.getByRole("button", { name: "Add port" }));
    expect((screen.getByRole("textbox", { name: "Mac port" }) as HTMLInputElement).value).toBe(
      "8081",
    );
    await userEvent.click(screen.getByRole("button", { name: "Add variable" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Variable name" }), "MODE");
    await userEvent.type(screen.getByRole("textbox", { name: "Value" }), "dev");
    await userEvent.click(screen.getByRole("button", { name: "Folder from Mac" }));
    await userEvent.click(await screen.findByRole("checkbox", { name: "Read only" }));
    await userEvent.click(screen.getByRole("radio", { name: "Always" }));
    await userEvent.click(screen.getByRole("radio", { name: "amd64 · Rosetta" }));
    await userEvent.type(
      screen.getByRole("textbox", { name: "Command" }),
      "nginx -g 'daemon off;'",
    );
    await userEvent.keyboard("{Meta>}{Enter}{/Meta}");
    await waitFor(() => expect(calls.some((call) => call.command === "containerRun")).toBe(true));
    const run = calls.find((call) => call.command === "containerRun");
    expect(run?.args.spec).toEqual({
      image: "nginx",
      name: "nginx-1",
      ports: [{ host: 8081, container: 80, protocol: "tcp" }],
      env: [{ key: "MODE", value: "dev" }],
      storage: [{ source: "/Users/ada/site", target: "/data", readOnly: true }],
      restart: "always",
      command: ["nginx", "-g", "daemon off;"],
      platform: "linux/amd64",
    });
  });

  it("names the container that already holds a port", async () => {
    setup();
    await userEvent.type(await screen.findByRole("textbox", { name: "Image" }), "nginx:1.29");
    await userEvent.click(screen.getByRole("button", { name: "Add port" }));
    const host = screen.getByRole("textbox", { name: "Mac port" });
    await userEvent.clear(host);
    await userEvent.type(host, "8080");
    await userEvent.click(screen.getByRole("button", { name: /^Run/ }));
    expect(await screen.findByText("Port 8080 is in use by db.")).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: "Remove port" }));
    expect(screen.queryByText("Port 8080 is in use by db.")).toBeNull();
  });

  it("shows why the engine refused", async () => {
    setup(() => {
      throw { kind: "engine", message: "pull access denied for nope" };
    });
    await userEvent.type(await screen.findByRole("textbox", { name: "Image" }), "nope");
    await userEvent.click(screen.getByRole("button", { name: /^Run/ }));
    expect(await screen.findByText("pull access denied for nope")).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(useRunSheet.getState().open).toBe(false);
  });

  it("copies the form as a docker run command", async () => {
    const calls = setup();
    await userEvent.type(await screen.findByRole("textbox", { name: "Image" }), "nginx:1.29");
    await userEvent.click(screen.getByRole("button", { name: "Copy as docker run" }));
    await waitFor(() =>
      expect(calls).toContainEqual(
        expect.objectContaining({
          command: "plugin:clipboard-manager|writeText",
          args: expect.objectContaining({
            text: "docker run -d --name nginx-1 --restart unless-stopped nginx:1.29",
          }),
        }),
      ),
    );
  });
});
