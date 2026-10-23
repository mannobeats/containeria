import clsx from "clsx";
import { useEffect, useRef } from "react";

import { formatTime, type LogLine } from "./logs-model";

const levelLabel = { error: "ERR", warning: "WARN", info: "INFO", debug: "DBG" } as const;

const rowTone = {
  error: "border-l-bad bg-[color-mix(in_oklch,var(--bad-soft)_70%,transparent)] text-bad-ink",
  warning: "border-l-transparent [&>.level]:text-warn-ink",
  info: "border-l-transparent",
  debug: "border-l-transparent text-ink-3",
} as const;

function Highlight({ text, query }: { text: string; query: string }) {
  const at = query ? text.toLowerCase().indexOf(query.toLowerCase()) : -1;
  if (at < 0) {
    return text;
  }
  return (
    <>
      {text.slice(0, at)}
      <mark className="rounded-[2px] bg-[light-dark(oklch(0.9_0.12_90),oklch(0.5_0.1_90))] text-inherit">
        {text.slice(at, at + query.length)}
      </mark>
      {text.slice(at + query.length)}
    </>
  );
}

function Row({ line, query, timestamps }: { line: LogLine; query: string; timestamps: boolean }) {
  return (
    <div
      className={clsx(
        "grid gap-3 border-l-2 px-5 py-px text-ink-2 [contain-intrinsic-size:auto_20px] [content-visibility:auto] hover:bg-hover",
        timestamps ? "grid-cols-[112px_44px_1fr]" : "grid-cols-[44px_1fr]",
        rowTone[line.level],
      )}
    >
      {timestamps ? <span className="text-ink-4 tabular">{formatTime(line.timestamp)}</span> : null}
      <span className="level text-ink-3">{levelLabel[line.level]}</span>
      <span className="break-words whitespace-pre-wrap">
        <Highlight text={line.message} query={query} />
      </span>
    </div>
  );
}

type LogListProps = {
  lines: LogLine[];
  query: string;
  timestamps: boolean;
  follow: boolean;
  onFollow: (follow: boolean) => void;
};

/**
 * Thousands of lines stay smooth: off-screen rows skip layout and paint (`content-visibility`),
 * and each row keeps its key while older lines scroll away, so React only adds the new ones.
 */
export function LogList({ lines, query, timestamps, follow, onFollow }: LogListProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const newest = lines.at(-1)?.seq;
  useEffect(() => {
    const element = scroller.current;
    if (follow && element && newest !== undefined) {
      element.scrollTop = element.scrollHeight;
    }
  }, [follow, newest]);
  const onScroll = () => {
    const element = scroller.current;
    if (element) {
      onFollow(element.scrollHeight - element.scrollTop - element.clientHeight < 24);
    }
  };
  return (
    <div
      ref={scroller}
      onScroll={onScroll}
      className="min-h-0 flex-1 overflow-auto pt-1.5 pb-4 font-mono text-mono-13 leading-[1.55] selectable"
    >
      {lines.map((line) => (
        <Row key={line.seq} line={line} query={query} timestamps={timestamps} />
      ))}
    </div>
  );
}
