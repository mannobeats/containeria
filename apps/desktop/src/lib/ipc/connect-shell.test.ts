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

  it("sends one size at a time, in order", async () => {
    let finish: (value: null) => void = () => undefined;
    const calls = mockCommands({
      shellResize: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    });
    const { terminal, opened, stop } = connecting();
    terminal.resize(120, 40);
    await opened();
    terminal.resize(100, 30);
    const sizes = () =>
      calls.filter((call) => call.command === "shellResize").map((call) => call.args.cols);
    await waitFor(() => expect(sizes()).toEqual([120]));
    finish(null);
    await waitFor(() => expect(sizes()).toEqual([120, 100]));
    stop();
  });

  it("stops sending keystrokes once it ends", async () => {
    const calls = mockCommands({});
    const { terminal, opened, stop } = connecting();
    await opened();
    const typed = () => calls.filter((call) => call.command === "shellInput");
    terminal.type("ls");
    await waitFor(() =>
      expect(typed()).toEqual([{ command: "shellInput", args: { stream: 7, text: "ls" } }]),
    );
    stop();
    terminal.type("pwd");
    await waitFor(() => expect(calls).toContainEqual({ command: "streamCancel", args: { id: 7 } }));
    expect(typed()).toHaveLength(1);
  });
});
