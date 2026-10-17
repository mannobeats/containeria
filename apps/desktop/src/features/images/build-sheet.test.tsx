import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useCompose } from "@/features/compose/store";
import { mockCommands, renderWithApp } from "@/test/harness";

import { BuildSheet } from "./build-sheet";
import { useImageSheet } from "./sheet-store";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: () => Promise.resolve("/Users/ada/Other App"),
}));

beforeEach(() => {
  useImageSheet.setState({ sheet: null, build: null });
  useCompose.setState({ run: null, runVisible: false });
});

describe("BuildSheet", () => {
  it("starts from a dropped Dockerfile and builds with the options picked", async () => {
    const calls = mockCommands({ imageBuild: () => 4 });
    act(() =>
      useImageSheet
        .getState()
        .openBuild({ context: "/Users/ada/shop", dockerfile: "Dockerfile.dev" }),
    );
    renderWithApp(<BuildSheet />);
    expect((await screen.findByLabelText("Image name")).getAttribute("value")).toBe("shop:latest");
    await userEvent.type(screen.getByLabelText("Build arguments"), "NODE_ENV=production");
    await userEvent.click(screen.getByRole("checkbox", { name: "Ignore the build cache" }));
    await userEvent.click(screen.getByRole("button", { name: "Build" }));
    await waitFor(() =>
      expect(calls).toContainEqual(
        expect.objectContaining({
          command: "imageBuild",
          args: expect.objectContaining({
            spec: {
              context: "/Users/ada/shop",
              dockerfile: "Dockerfile.dev",
              tag: "shop:latest",
              buildArgs: ["NODE_ENV=production"],
              noCache: true,
              pull: false,
            },
          }),
        }),
      ),
    );
    expect(useCompose.getState().run?.title).toBe("Building shop:latest");
  });

  it("waits for a folder and names the image after the one chosen", async () => {
    mockCommands({});
    act(() => useImageSheet.getState().openBuild());
    renderWithApp(<BuildSheet />);
    const build = await screen.findByRole("button", { name: "Build" });
    expect(build.hasAttribute("disabled")).toBe(true);
    await userEvent.click(screen.getByRole("button", { name: "Choose…" }));
    await waitFor(() =>
      expect(screen.getByLabelText("Image name").getAttribute("value")).toBe("other-app:latest"),
    );
    expect(build.hasAttribute("disabled")).toBe(false);
  });
});
