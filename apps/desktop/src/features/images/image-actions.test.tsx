import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { useCompose } from "@/features/compose/store";
import { useRunSheet } from "@/features/containers/run/api";
import { engineFixture, imageFixture } from "@/test/fixtures";
import { mockCommands, renderWithApp } from "@/test/harness";

import { ImagesPage } from "./images-page";

const nginx = imageFixture({
  id: "sha256:ng",
  repository: "nginx",
  tag: "1.29",
  references: ["nginx:1.29"],
  sizeBytes: 200_000_000,
});

function setup() {
  const calls = mockCommands({
    engineStatus: () => engineFixture(),
    imagesList: () => [nginx],
    containersList: () => [],
    imagePush: () => 5,
    imageScan: () => ({
      reference: "nginx:1.29",
      vulnerabilities: [
        {
          id: "CVE-2026-1",
          package: "openssl",
          installed: "3.5.0",
          fixed: "3.5.1",
          severity: "critical",
          title: "Buffer overflow",
          url: null,
          target: "debian 13.1",
        },
        {
          id: "CVE-2026-2",
          package: "zlib",
          installed: "1.3",
          fixed: null,
          severity: "low",
          title: null,
          url: null,
          target: "debian 13.1",
        },
      ],
    }),
  });
  renderWithApp(<ImagesPage />);
  return calls;
}

async function rightClick(name: string) {
  const cell = await screen.findByText("nginx");
  fireEvent.contextMenu(cell);
  await userEvent.click(await screen.findByRole("menuitem", { name }));
}

beforeEach(() => {
  useCompose.setState({ run: null, runVisible: false });
  useRunSheet.setState({ open: false, image: "" });
});

describe("image actions", () => {
  it("scans an image and lists what it finds", async () => {
    setup();
    await rightClick("Scan for Vulnerabilities");
    expect(await screen.findByText("CVE-2026-1")).toBeDefined();
    expect(screen.getByText(/2 vulnerabilities/)).toBeDefined();
    expect(screen.getByText("3.5.0 → 3.5.1")).toBeDefined();
  });

  it("filters what a scan found by severity", async () => {
    setup();
    await rightClick("Scan for Vulnerabilities");
    await screen.findByText("CVE-2026-1");
    await userEvent.click(screen.getByRole("radio", { name: /Low/ }));
    expect(screen.getByText("CVE-2026-2")).toBeDefined();
    expect(screen.queryByText("CVE-2026-1")).toBeNull();
  });

  it("starts the tag sheet empty each time it opens", async () => {
    setup();
    await rightClick("Tag…");
    await userEvent.type(await screen.findByRole("textbox", { name: "New reference" }), "x:1");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await rightClick("Tag…");
    expect(
      (await screen.findByRole("textbox", { name: "New reference" })).getAttribute("value"),
    ).toBe("");
  });

  it("asks before pushing, then streams the push", async () => {
    const calls = setup();
    await rightClick("Push…");
    expect(await screen.findByText(/Docker Hub/)).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: "Push" }));
    await waitFor(() =>
      expect(calls).toContainEqual(
        expect.objectContaining({
          command: "imagePush",
          args: expect.objectContaining({ reference: "nginx:1.29" }),
        }),
      ),
    );
    expect(useCompose.getState().run?.title).toBe("Pushing nginx:1.29");
  });

  it("runs a container from the image", async () => {
    setup();
    await rightClick("Run…");
    expect(useRunSheet.getState()).toMatchObject({ open: true, image: "nginx:1.29" });
  });
});
