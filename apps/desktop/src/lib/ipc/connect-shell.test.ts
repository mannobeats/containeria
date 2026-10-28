import { waitFor } from "@testing-library/react";
import type { Terminal } from "@xterm/xterm";
import { describe, expect, it, vi } from "vitest";

import { FakeTerminal } from "@/test/canvas-mocks";
import { mockCommands } from "@/test/harness";

import { connectShell } from "./connect-shell";

/** Connects a terminal to a shell that opens as stream 7 when the test says so. */
function connecting() {
  const terminal = FakeTerminal();
  const onStatus = vi.fn();
  let open: (stream: number) => void = () => undefined;
  const stop = connectShell(
    terminal as unknown as Terminal,
    () =>
      new Promise((resolve) => {
        open = resolve;
      }),
    onStatus,
  );
  const opened = async () => {
    open(7);
    await waitFor(() => expect(onStatus).toHaveBeenCalledWith({ state: "open" }));
  };
  return { terminal, opened, stop };
}

describe("connectShell", () => {
  it("sends the size the terminal reached while the shell was opening", async () => {
    const calls = mockCommands({});
    const { terminal, opened, stop } = connecting();
    terminal.resize(120, 40);
    await opened();
    await waitFor(() =>
      expect(calls).toContainEqual({
        command: "shellResize",
        args: { stream: 7, cols: 120, rows: 40 },
      }),
    );
    stop();
  });

  it("stops sending keystrokes once it ends", async () => {
    const calls = mockCommands({});
    const { terminal, opened, stop } = connecting();
    await opened();
    stop();
    terminal.type("ls");
    await waitFor(() => expect(calls).toContainEqual({ command: "streamCancel", args: { id: 7 } }));
    expect(calls.some((call) => call.command === "shellInput")).toBe(false);
  });
});
