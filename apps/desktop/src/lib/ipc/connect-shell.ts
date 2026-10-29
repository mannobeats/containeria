import { Channel } from "@tauri-apps/api/core";
import type { Terminal } from "@xterm/xterm";

import { commands, type ShellEvent } from "./bindings";
import { errorMessage } from "./errors";

export type TerminalStatus =
  | { state: "connecting" }
  | { state: "open" }
  | { state: "closed" }
  | { state: "failed"; message: string };

/** Starts a shell sized `cols` × `rows` that streams into `channel`; resolves to its stream id. */
export type OpenShell = (
  cols: number,
  rows: number,
  channel: Channel<ShellEvent>,
) => Promise<number>;

/**
 * Runs the shell `open` starts on `terminal`: output is drawn, keystrokes go to `shell_input`, size
 * changes to `shell_resize`. Returns what ends the shell.
 */
export function connectShell(
  terminal: Terminal,
  open: OpenShell,
  onStatus: (status: TerminalStatus) => void,
): () => void {
  let stream: number | undefined;
  let connected = true;
  // Rust handles each resize on its own task, so one sent before the last finishes can land after it.
  let resized = Promise.resolve();
  const resize = (id: number, cols: number, rows: number) => {
    resized = resized
      .then(() => commands.shellResize(id, cols, rows))
      .then(
        () => undefined,
        () => undefined,
      );
  };
  const channel = new Channel<ShellEvent>((event) => {
    if (event.kind === "output") {
      terminal.write(event.text);
    } else {
      onStatus({ state: "closed" });
    }
  });
  const { cols, rows } = terminal;
  open(cols, rows, channel)
    .then((opened) => {
      stream = opened;
      if (!connected) {
        commands.streamCancel(opened).catch(() => undefined);
        return;
      }
      onStatus({ state: "open" });
      if (terminal.cols !== cols || terminal.rows !== rows) {
        resize(opened, terminal.cols, terminal.rows);
      }
      terminal.focus();
    })
    .catch((error: unknown) => onStatus({ state: "failed", message: errorMessage(error) }));
  const typing = terminal.onData((text) => {
    if (stream !== undefined) {
      commands.shellInput(stream, text).catch(() => undefined);
    }
  });
  const resizing = terminal.onResize(({ cols, rows }) => {
    if (stream !== undefined) {
      resize(stream, cols, rows);
    }
  });
  return () => {
    connected = false;
    typing.dispose();
    resizing.dispose();
    if (stream !== undefined) {
      commands.streamCancel(stream).catch(() => undefined);
    }
  };
}
