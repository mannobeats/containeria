import "@xterm/xterm/css/xterm.css";

import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useEffect, useEffectEvent, useRef } from "react";

import { resolveColor } from "@/lib/resolve-color";

const FONT_FAMILY = "Geist Mono Variable";
const FONT_SIZE = 12.5;

function open(host: HTMLElement): { terminal: Terminal; fit: FitAddon } {
  const terminal = new Terminal({
    cursorBlink: true,
    fontFamily: `"${FONT_FAMILY}", ui-monospace, Menlo, monospace`,
    fontSize: FONT_SIZE,
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
  terminal.focus();
  return { terminal, fit };
}

type TerminalViewProps = {
  label: string;
  /** Wires a shell to the terminal once it's drawn; returns what disconnects it. */
  connect: (terminal: Terminal) => () => void;
};

/**
 * A terminal filling its pane: the same dark well in light and dark mode, sized to the pane, with
 * keyboard focus. Remount it to start a new session.
 */
export function TerminalView({ label, connect }: TerminalViewProps) {
  const host = useRef<HTMLElement>(null);
  const attach = useEffectEvent(connect);
  useEffect(() => {
    const element = host.current;
    if (!element) {
      return;
    }
    let session: { terminal: Terminal; fit: FitAddon; detach: () => void } | undefined;
    let unmounted = false;
    const observer = new ResizeObserver(() => session?.fit.fit());
    observer.observe(element);
    // xterm measures its cells once, from the font it has at open; a fallback font misaligns them.
    document.fonts
      .load(`${FONT_SIZE}px "${FONT_FAMILY}"`)
      .catch(() => undefined)
      .then(() => {
        if (unmounted) {
          return;
        }
        const { terminal, fit } = open(element);
        session = { terminal, fit, detach: attach(terminal) };
      });
    return () => {
      unmounted = true;
      observer.disconnect();
      session?.detach();
      session?.terminal.dispose();
    };
  }, []);
  return (
    <div className="min-h-0 flex-1 bg-term-bg py-2 pl-3">
      <section ref={host} aria-label={label} className="h-full" />
    </div>
  );
}
