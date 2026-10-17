import { Channel } from "@tauri-apps/api/core";
import type { Terminal } from "@xterm/xterm";

import { commands } from "@/lib/ipc/bindings";
import { errorMessage } from "@/lib/ipc/errors";
import { TerminalView } from "@/ui/terminal-view";

/** Connects a terminal to a login shell in the machine. Returns what undoes it. */
function attachShell(terminal: Terminal, name: string): () => void {
  let id: number | undefined;
  let attached = true;
  const output = new Channel<string>((text) => terminal.write(text));
  commands
    .machineShell(name, terminal.cols, terminal.rows, output)
    .then((streamId) => {
      id = streamId;
      if (!attached) {
        commands.streamCancel(streamId).catch(() => undefined);
      }
    })
    .catch((error: unknown) => terminal.write(`\r\n${errorMessage(error)}\r\n`));
  const typing = terminal.onData((data) => {
    if (id !== undefined) {
      commands.machineShellInput(id, data).catch(() => undefined);
    }
  });
  const resizing = terminal.onResize(({ cols, rows }) => {
    if (id !== undefined) {
      commands.machineShellResize(id, cols, rows).catch(() => undefined);
    }
  });
  return () => {
    attached = false;
    typing.dispose();
    resizing.dispose();
    if (id !== undefined) {
      commands.streamCancel(id).catch(() => undefined);
    }
  };
}

/** A root login shell in the machine, sized to the pane. */
export function MachineTerminal({ name }: { name: string }) {
  return (
    <TerminalView
      key={name}
      label={`Terminal in ${name}`}
      connect={(terminal) => attachShell(terminal, name)}
    />
  );
}
