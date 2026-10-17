/**
 * happy-dom has no canvas, so uPlot and xterm are replaced in tests by these stand-ins. They record
 * what the app gives them, so tests can check it and drive their callbacks. They're plain
 * functions called with `new`, the way the real libraries are.
 */

type Data = (number | null | undefined)[][];
type PlotOptions = { height: number; hooks?: { setCursor?: ((plot: Plot) => void)[] } };

type Plot = {
  height: number;
  data: Data;
  cursor: { idx: number | null };
  setData: (data: Data) => void;
  setSize: () => void;
  destroy: () => void;
  /** Moves the cursor to a point, as hovering would. */
  hover: (index: number | null) => void;
};

export const plots: Plot[] = [];

export function FakePlot(options: PlotOptions, data: Data): Plot {
  const plot: Plot = {
    height: options.height,
    data,
    cursor: { idx: null },
    setData: (next) => {
      plot.data = next;
    },
    setSize: () => undefined,
    destroy: () => undefined,
    hover: (index) => {
      plot.cursor.idx = index;
      for (const hook of options.hooks?.setCursor ?? []) {
        hook(plot);
      }
    },
  };
  plots.push(plot);
  return plot;
}

type Listener<T> = (value: T) => void;

type Terminal = {
  cols: number;
  rows: number;
  written: string;
  /** Types as the user would. */
  type: Listener<string>;
  resize: (cols: number, rows: number) => void;
};

export const terminals: Terminal[] = [];

export function FakeTerminal() {
  let typing: Listener<string> = () => undefined;
  let resizing: Listener<{ cols: number; rows: number }> = () => undefined;
  const subscription = { dispose: () => undefined };
  const terminal = {
    cols: 80,
    rows: 24,
    written: "",
    loadAddon: () => undefined,
    open: () => undefined,
    focus: () => undefined,
    dispose: () => undefined,
    write: (text: string) => {
      terminal.written += text;
    },
    onData: (listener: Listener<string>) => {
      typing = listener;
      return subscription;
    },
    onResize: (listener: Listener<{ cols: number; rows: number }>) => {
      resizing = listener;
      return subscription;
    },
    type: (text: string) => typing(text),
    resize: (cols: number, rows: number) => resizing({ cols, rows }),
  };
  terminals.push(terminal);
  return terminal;
}

export function FakeFitAddon() {
  return { fit: () => undefined };
}
