import "@xterm/xterm/css/xterm.css";

import { Channel } from "@tauri-apps/api/core";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useEffect, useRef } from "react";

import { commands } from "@/lib/ipc/bindings";
import { errorMessage } from "@/lib/ipc/errors";

/** Always a dark well, in light and dark mode alike, as in the design. */
const THEME = {
  background: "oklch(0.17 0.008 255)",
  foreground: "oklch(0.88 0.005 255)",
  cursor: "oklch(0.85 0.1 255)",
  selectionBackground: "oklch(0.45 0.08 255 / 0.6)",
};

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

/** A real terminal: a root login shell in the machine, sized to the pane. */
export function MachineTerminal({ name }: { name: string }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = host.current;
    if (!element) {
      return;
    }
    const terminal = new Terminal({
      fontFamily: '"Geist Mono Variable", ui-monospace, Menlo, monospace',
      fontSize: 12.5,
      lineHeight: 1.25,
      cursorBlink: true,
      theme: THEME,
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(element);
    fit.fit();
    terminal.focus();
    const detach = attachShell(terminal, name);
    const observer = new ResizeObserver(() => fit.fit());
    observer.observe(element);
    return () => {
      observer.disconnect();
      detach();
      terminal.dispose();
    };
  }, [name]);
  return (
    <section
      ref={host}
      aria-label={`Terminal in ${name}`}
      className="min-h-0 flex-1 bg-[oklch(0.17_0.008_255)] px-3 py-2"
    />
  );
}
