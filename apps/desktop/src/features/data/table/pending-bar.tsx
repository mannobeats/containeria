import { IconCode } from "@tabler/icons-react";
import { m } from "motion/react";

import { Button } from "@/ui/button";
import { Kbd } from "@/ui/kbd";

type PendingBarProps = {
  count: number;
  table: string;
  summary: string;
  committing: boolean;
  onReview: () => void;
  onDiscard: () => void;
  onCommit: () => void;
};

/** The signature: staged changes float over the grid until they're committed or thrown away. */
export function PendingBar({
  count,
  table,
  summary,
  committing,
  onReview,
  onDiscard,
  onCommit,
}: PendingBarProps) {
  return (
    <m.div
      role="status"
      initial={{ opacity: 0, y: 14, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: "spring", bounce: 0.2, duration: 0.32 }}
      className="absolute bottom-[52px] left-1/2 z-[8] flex min-w-[520px] -translate-x-1/2 items-center gap-3 rounded-lg bg-[light-dark(oklch(0.995_0_0/0.9),oklch(0.28_0.006_255/0.92))] py-2 pr-2 pl-2.5 shadow-[var(--shadow-3),inset_0_0_0_0.5px_var(--brand-line)] backdrop-blur-xl"
    >
      <span className="grid size-[30px] place-items-center rounded-md bg-brand text-14 font-semibold text-white tabular">
        {count}
      </span>
      <span className="flex flex-col">
        <b className="text-13 font-semibold text-ink">
          {count} {count === 1 ? "change" : "changes"} to {table}
        </b>
        <span className="text-12 text-ink-3">{summary}</span>
      </span>
      <span className="ml-auto flex items-center gap-1">
        <Button variant="ghost" size="sm" onClick={onReview}>
          <IconCode />
          Review SQL
        </Button>
        <Button variant="ghost" size="sm" onClick={onDiscard}>
          Discard
        </Button>
        <Button variant="brand" size="sm" loading={committing} onClick={onCommit}>
          Commit
          <Kbd className="bg-white/15 text-white shadow-none">⌘S</Kbd>
        </Button>
      </span>
    </m.div>
  );
}
