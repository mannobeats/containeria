import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useFileDrop } from "./use-file-drop";

type DragPayload = { type: "enter" | "drop"; paths: string[] } | { type: "over" | "leave" };

const listeners: ((event: { payload: DragPayload }) => void)[] = [];

vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: (listener: (event: { payload: DragPayload }) => void) => {
      listeners.push(listener);
      return Promise.resolve(() => undefined);
    },
  }),
}));

const send = (payload: DragPayload) => act(() => listeners.at(-1)?.({ payload }));
const isYaml = (path: string) => path.endsWith(".yaml");

describe("useFileDrop", () => {
  it("shows the target only for files it takes, and hands over the dropped one", async () => {
    const onDrop = vi.fn();
    const { result } = renderHook(() => useFileDrop(isYaml, onDrop));
    await waitFor(() => expect(listeners.length).toBeGreaterThan(0));
    send({ type: "enter", paths: ["/a/photo.png"] });
    expect(result.current).toBe(false);
    send({ type: "enter", paths: ["/a/photo.png", "/a/compose.yaml"] });
    expect(result.current).toBe(true);
    send({ type: "over" });
    expect(result.current).toBe(true);
    send({ type: "drop", paths: ["/a/photo.png", "/a/compose.yaml"] });
    expect(result.current).toBe(false);
    expect(onDrop).toHaveBeenCalledWith("/a/compose.yaml");
  });

  it("forgets the drag when it leaves, and ignores drops it doesn't take", async () => {
    const onDrop = vi.fn();
    const { result } = renderHook(() => useFileDrop(isYaml, onDrop));
    await waitFor(() => expect(listeners.length).toBeGreaterThan(0));
    send({ type: "enter", paths: ["/a/compose.yaml"] });
    send({ type: "leave" });
    expect(result.current).toBe(false);
    send({ type: "drop", paths: ["/a/photo.png"] });
    expect(onDrop).not.toHaveBeenCalled();
  });
});
