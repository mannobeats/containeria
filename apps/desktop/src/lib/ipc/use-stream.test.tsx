import type { Channel } from "@tauri-apps/api/core";
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { mockCommands, sendToChannel } from "@/test/harness";

import { useStream } from "./use-stream";

describe("useStream", () => {
  it("drops what the old stream still sends after the key changes", async () => {
    const calls = mockCommands({});
    const channels: Channel<string>[] = [];
    const onMessage = vi.fn();
    const { rerender } = renderHook(
      ({ key }) =>
        useStream<string>(
          key,
          (channel) => {
            channels.push(channel);
            return Promise.resolve(channels.length);
          },
          onMessage,
        ),
      { initialProps: { key: "web" } },
    );
    rerender({ key: "db" });
    await waitFor(() => expect(calls).toContainEqual({ command: "streamCancel", args: { id: 1 } }));
    sendToChannel(channels[0], "web line");
    sendToChannel(channels[1], "db line");
    expect(onMessage.mock.calls).toEqual([["db line"]]);
  });
});
