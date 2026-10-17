import { Channel } from "@tauri-apps/api/core";
import type { Terminal } from "@xterm/xterm";

import { commands, type ShellEvent } from "@/lib/ipc/bindings";
import { errorMessage } from "@/lib/ipc/errors";

export type TerminalStatus =
  | { state: "connecting" }
  | { state: "open" }
  | { state: "closed" }
  | { state: "failed"; message: string };

/**
 * Runs a shell in the container on `terminal`: output is drawn, keystrokes go to `shell_input`,
 * size changes to `shell_resize`. Returns what ends the shell.
 */
export function connectShell(
  terminal: Terminal,
  id: string,
  debug: boolean,
  onStatus: (status: TerminalStatus) => void,
): () => void {
  let stream: number | undefined;
  let connected = true;
  const channel = new Channel<ShellEvent>((event) => {
    if (event.kind === "output") {
      terminal.write(event.text);
    } else {
      onStatus({ state: "closed" });
    }
  });
  commands
    .containerShell(id, debug, terminal.cols, terminal.rows, channel)
    .then((opened) => {
      stream = opened;
      if (!connected) {
        commands.streamCancel(opened).catch(() => undefined);
        return;
      }
      onStatus({ state: "open" });
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
      commands.shellResize(stream, cols, rows).catch(() => undefined);
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
