import { useEffect, useRef } from "react";

/** Plain output, newest at the bottom, sticking to the end unless scrolled up. */
export function LogView({ label, lines }: { label: string; lines: string[] }) {
  const view = useRef<HTMLPreElement>(null);
  // Read where the reader is before new lines grow the log, not after: a batch taller than the
  // threshold would otherwise unstick a reader who was at the end.
  const stuck = useRef(true);
  useEffect(() => {
    const element = view.current;
    if (element && stuck.current) {
      element.scrollTop = element.scrollHeight;
    }
  });
  return (
    <pre
      ref={view}
      role="log"
      aria-label={label}
      onScroll={(event) => {
        const element = event.currentTarget;
        stuck.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
      }}
      className="selectable m-0 h-full overflow-auto bg-[light-dark(oklch(0.985_0_0),oklch(0.16_0.005_255))] px-5 py-3 font-mono text-mono-12 leading-[1.6] whitespace-pre-wrap text-ink-2"
    >
      {lines.length === 0 ? <span className="text-ink-4">No output yet.</span> : lines.join("\n")}
    </pre>
  );
}
