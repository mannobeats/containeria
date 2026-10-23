import clsx from "clsx";
import type { ReactNode } from "react";

const tones = {
  neutral: "bg-fill text-ink-2",
  ok: "bg-ok-soft text-ok-ink",
  warn: "bg-warn-soft text-warn-ink",
  bad: "bg-bad-soft text-bad-ink",
  brand: "bg-brand-soft text-brand-ink",
  line: "bg-transparent text-ink-2 hairline",
} as const;

type ChipTone = keyof typeof tones;

type ChipProps = { tone?: ChipTone; mono?: boolean; className?: string; children: ReactNode };

export function Chip({ tone = "neutral", mono = false, className, children }: ChipProps) {
  return (
    <span
      className={clsx(
        "inline-flex h-5 items-center gap-1 whitespace-nowrap rounded-[5px] px-[7px] [&_.tabler-icon]:size-[13px]",
        mono ? "font-mono text-mono-12 font-[450]" : "text-12 font-medium",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
