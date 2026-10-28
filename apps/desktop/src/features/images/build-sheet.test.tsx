import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useCompose } from "@/features/compose/store";
import { mockCommands, renderWithApp } from "@/test/harness";

import { BuildSheet } from "./build-sheet";
import { DockerfileDropTarget } from "./dockerfile-drop-target";
import { useImageSheet } from "./sheet-store";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: () => Promise.resolve("/Users/ada/Other App"),
}));

type DropListener = (event: { payload: { type: "drop"; paths: string[] } }) => void;
const dropListeners: DropListener[] = [];

vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: (listener: DropListener) => {
      dropListeners.push(listener);
      return Promise.resolve(() => undefined);
    },
  }),
}));

beforeEach(() => {
  useImageSheet.setState({ sheet: null, build: null });
  useCompose.setState({ run: null, runVisible: false });
});

describe("BuildSheet", () => {
  it("opens on a Dockerfile dropped on the window, in that file's folder", async () => {
    mockCommands({});
    renderWithApp(
      <>
        <DockerfileDropTarget />
        <BuildSheet />
      </>,
    );
    await waitFor(() => expect(dropListeners.length).toBeGreaterThan(0));
    act(() =>
      dropListeners.at(-1)?.({
        payload: { type: "drop", paths: ["/Users/ada/shop/Dockerfile.dev"] },
      }),
    );
    expect((await screen.findByLabelText("Folder")).getAttribute("value")).toBe("/Users/ada/shop");
    expect(screen.getByLabelText("Dockerfile").getAttribute("value")).toBe("Dockerfile.dev");
    expect(screen.getByLabelText("Image name").getAttribute("value")).toBe("shop:latest");
  });

  it("forgets the Dockerfile when another folder is chosen", async () => {
    mockCommands({});
    act(() =>
      useImageSheet
        .getState()
        .openBuild({ context: "/Users/ada/shop", dockerfile: "Dockerfile.dev" }),
    );
    renderWithApp(<BuildSheet />);
    await userEvent.click(await screen.findByRole("button", { name: "Choose…" }));
    await waitFor(() =>
      expect(screen.getByLabelText("Folder").getAttribute("value")).toBe("/Users/ada/Other App"),
    );
    expect(screen.getByLabelText("Dockerfile").getAttribute("value")).toBe("");
  });

  it("builds a prefilled form with the options picked", async () => {
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
