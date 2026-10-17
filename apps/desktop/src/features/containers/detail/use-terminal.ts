import "@xterm/xterm/css/xterm.css";

import { Channel } from "@tauri-apps/api/core";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { type RefObject, useEffect, useState } from "react";

import { commands, type ShellEvent } from "@/lib/ipc/bindings";
import { errorMessage } from "@/lib/ipc/errors";
import { resolveColor } from "@/lib/resolve-color";

export type TerminalStatus =
  | { state: "connecting" }
  | { state: "open" }
  | { state: "closed" }
  | { state: "failed"; message: string };

function create(host: HTMLElement): { terminal: Terminal; fit: FitAddon } {
  const terminal = new Terminal({
    cursorBlink: true,
    fontFamily: '"Geist Mono Variable", ui-monospace, Menlo, monospace',
    fontSize: 12.5,
    lineHeight: 1.25,
    scrollback: 5000,
    theme: {
      background: resolveColor(host, "var(--term-bg)"),
      foreground: resolveColor(host, "var(--term-fg)"),
      cursor: resolveColor(host, "var(--term-cursor)"),
      selectionBackground: resolveColor(host, "var(--term-selection)"),
    },
  });
  const fit = new FitAddon();
  terminal.loadAddon(fit);
  terminal.open(host);
  fit.fit();
  return { terminal, fit };
}

/**
 * A live shell in the element `host`: xterm draws, keystrokes go to `shell_input`, size changes to
 * `shell_resize`. Remount the component to reconnect or switch shells.
 */
export function useTerminal(host: RefObject<HTMLDivElement | null>, id: string, debug: boolean) {
  const [status, setStatus] = useState<TerminalStatus>({ state: "connecting" });
  useEffect(() => {
    const element = host.current;
    if (!element) {
      return;
    }
    const { terminal, fit } = create(element);
    let stream: number | undefined;
    let disposed = false;
    const channel = new Channel<ShellEvent>((event) => {
      if (event.kind === "output") {
        terminal.write(event.text);
      } else {
        setStatus({ state: "closed" });
      }
    });
    commands
      .containerShell(id, debug, terminal.cols, terminal.rows, channel)
      .then((opened) => {
        stream = opened;
        if (disposed) {
          commands.streamCancel(opened).catch(() => undefined);
          return;
        }
        setStatus({ state: "open" });
        terminal.focus();
      })
      .catch((error: unknown) => setStatus({ state: "failed", message: errorMessage(error) }));
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
    const observer = new ResizeObserver(() => fit.fit());
    observer.observe(element);
    return () => {
      disposed = true;
      observer.disconnect();
      typing.dispose();
      resizing.dispose();
      terminal.dispose();
      if (stream !== undefined) {
        commands.streamCancel(stream).catch(() => undefined);
      }
    };
  }, [host, id, debug]);
  return status;
}
