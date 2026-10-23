import clsx from "clsx";

import { highlightSql } from "./sql-highlight";

/** Read-only, highlighted SQL, as in history and the review sheet. */
export function SqlText({ sql, className }: { sql: string; className?: string }) {
  return (
    <pre
      className={clsx(
        "m-0 font-mono text-mono-13 leading-[1.55] whitespace-pre-wrap text-ink select-text",
        className,
      )}
    >
      {highlightSql(sql).map((span) => (
        <span key={span.from} className={span.className}>
          {span.text}
        </span>
      ))}
    </pre>
  );
}
