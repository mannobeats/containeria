import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { containerFixture, engineFixture, imageFixture } from "@/test/fixtures";
import { mockCommands, renderWithApp, sendToChannel } from "@/test/harness";

import { ImagesPage } from "./images-page";
import { useImageSheet } from "./sheet-store";

beforeEach(() => useImageSheet.setState({ sheet: null }));

const postgres = imageFixture({
  id: "sha256:pg",
  repository: "postgres",
  tag: "18",
  references: ["postgres:18"],
  containers: 1,
  sizeBytes: 400_000_000,
});
const redis = imageFixture({
  id: "sha256:rd",
  repository: "redis",
  tag: "8",
  references: ["redis:8"],
  sizeBytes: 100_000_000,
});
const layer = imageFixture({
  id: "sha256:dd",
  repository: null,
  tag: null,
  references: [],
  dangling: true,
  sizeBytes: 50_000_000,
});

function setup(images = [postgres, redis, layer]) {
  const calls = mockCommands({
    engineStatus: () => engineFixture(),
    imagesList: () => images,
    containersList: () => [containerFixture({ id: "db", name: "shop-db-1", image: "postgres:18" })],
    imagesPrune: () => ({ removed: 2, reclaimedBytes: 150_000_000 }),
    hubSearch: () => [
      { name: "nginx", description: "Official build of Nginx", official: true, stars: 20_600 },
    ],
    imagePull: () => 7,
  });
  renderWithApp(<ImagesPage />);
  return calls;
}

describe("ImagesPage", () => {
  it("answers how much disk images use and what can go", async () => {
    setup();
    expect(await screen.findByText("redis")).toBeDefined();
    expect(screen.getByText(/across 3 images/).textContent).toContain("550 MB");
    expect(screen.getByText(/isn't used by any container/).textContent).toContain("150 MB");
    expect(screen.getByText("Dangling build layer")).toBeDefined();
    expect(await screen.findByText("shop-db-1")).toBeDefined();
  });

  it("says nothing about disk use before the images have loaded", async () => {
    const calls = mockCommands({ engineStatus: () => engineFixture({ phase: "stopped" }) });
    renderWithApp(<ImagesPage />);
    await waitFor(() => expect(calls.map((call) => call.command)).toContain("engineStatus"));
    expect(screen.queryByText("No images match this filter")).toBeNull();
    expect(screen.queryByText(/across 0 images/)).toBeNull();
  });

  it("filters by kind", async () => {
    setup();
    await screen.findByText("redis");
    await userEvent.click(screen.getByRole("radio", { name: /Unused/ }));
    expect(screen.getByText("redis")).toBeDefined();
    expect(screen.queryByText("postgres")).toBeNull();
  });

  it("filters by search", async () => {
    setup();
    await screen.findByText("redis");
    await userEvent.type(screen.getByPlaceholderText("Filter images"), "redis");
    expect(screen.getByText("redis")).toBeDefined();
    expect(screen.queryByText("postgres")).toBeNull();
    expect(screen.queryByText("Dangling build layer")).toBeNull();
  });

  it("says when nothing matches the filter", async () => {
    setup();
    await screen.findByText("redis");
    await userEvent.type(screen.getByPlaceholderText("Filter images"), "nothing-like-this");
    expect(await screen.findByText("No images match this filter")).toBeDefined();
  });

  it("deletes an unused image after confirming", async () => {
    const calls = setup();
    await userEvent.click(await screen.findByRole("button", { name: "Delete redis" }));
    await userEvent.click(await screen.findByRole("button", { name: "Delete image" }));
    await waitFor(() =>
      expect(calls).toContainEqual({
        command: "imageRemove",
        args: { id: "sha256:rd", force: false },
      }),
    );
  });

  it("won't delete an image a container uses", async () => {
    setup();
    expect(
      (
        (await screen.findByRole("button", {
          name: /stop its containers first postgres/,
        })) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("cleans up everything unused", async () => {
    const calls = setup();
    await userEvent.click(await screen.findByRole("button", { name: /Clean up 150 MB/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Delete 2 images" }));
    await waitFor(() =>
      expect(calls).toContainEqual({ command: "imagesPrune", args: { all: true } }),
    );
  });

  it("cleans up only dangling layers when asked", async () => {
    const calls = setup();
    await userEvent.click(await screen.findByRole("button", { name: /Clean up 150 MB/ }));
    await userEvent.click(await screen.findByRole("radio", { name: /Dangling layers only/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Delete 1 image" }));
    await waitFor(() =>
      expect(calls).toContainEqual({ command: "imagesPrune", args: { all: false } }),
    );
  });

  it("stops listening to a pull once it's cancelled", async () => {
    let channel: unknown;
    const calls = mockCommands({
      engineStatus: () => engineFixture(),
      imagesList: () => [redis],
      imagePull: (args) => {
        channel = args.channel;
        return 7;
      },
    });
    renderWithApp(<ImagesPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Pull image" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Image to pull" }), "ghcr.io/a/b:1");
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Pull" }));
    await userEvent.click(await screen.findByRole("button", { name: "Cancel pull" }));
    await waitFor(() => expect(calls).toContainEqual({ command: "streamCancel", args: { id: 7 } }));
    act(() =>
      sendToChannel(channel, {
        kind: "progress",
        progress: { layer: "l1", status: "Downloading", current: 1, total: 2 },
      }),
    );
    expect(screen.queryByRole("heading", { name: "Pulling ghcr.io/a/b:1" })).toBeNull();
  });

  it("pulls an image picked from Docker Hub", async () => {
    const calls = setup();
    await userEvent.click(await screen.findByRole("button", { name: "Pull image" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Image to pull" }), "nginx");
    await userEvent.click(await screen.findByRole("button", { name: /Official build of Nginx/ }));
    await userEvent.clear(screen.getByRole("textbox", { name: "Tag" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Tag" }), "1.29");
    const sheet = screen.getByRole("dialog");
    await userEvent.click(within(sheet).getByRole("button", { name: "Pull" }));
    await waitFor(() =>
      expect(
        calls.some((call) => call.command === "imagePull" && call.args.reference === "nginx:1.29"),
      ).toBe(true),
    );
    expect(await screen.findByRole("heading", { name: "Pulling nginx:1.29" })).toBeDefined();
  });

  it("invites a first pull when there are no images", async () => {
    setup([]);
    expect(await screen.findByText("No images yet")).toBeDefined();
  });

  it("deletes the selected unused images, but never one a container uses", async () => {
    const calls = setup();
    await screen.findByText("redis");
    expect(
      (screen.getByRole("checkbox", { name: "Select postgres:18" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    await userEvent.click(
      screen.getByRole("checkbox", { name: "Select all images that aren't in use" }),
    );
    await userEvent.click(
      within(screen.getByRole("toolbar", { name: "Selected images" })).getByRole("button", {
        name: "Delete",
      }),
    );
    await userEvent.click(await screen.findByRole("button", { name: "Delete 2 images" }));
    await waitFor(() =>
      expect(
        calls.filter((call) => call.command === "imageRemove").map((call) => call.args),
      ).toEqual([
        { id: "sha256:rd", force: false },
        { id: "sha256:dd", force: false },
      ]),
    );
  });

  it("selects with ⌘-click and ⇧-click on rows instead of opening them", async () => {
    const user = userEvent.setup();
    setup([
      redis,
      layer,
      imageFixture({ id: "sha256:ng", repository: "nginx", references: ["nginx:1"] }),
    ]);
    await user.click(await screen.findByRole("checkbox", { name: "Select redis:8" }));
    await user.keyboard("{Shift>}");
    await user.click(screen.getByText("nginx"));
    await user.keyboard("{/Shift}");
    expect(screen.getByText("3 selected")).toBeDefined();
    await user.keyboard("{Meta>}");
    await user.click(screen.getByText("redis"));
    await user.keyboard("{/Meta}");
    expect(screen.getByText("2 selected")).toBeDefined();
  });
});
