import clsx from "clsx";
import type { ReactNode } from "react";

const tones = {
  neutral: "bg-fill text-ink-2",
  bad: "bg-bad-soft text-bad-ink",
  warn: "bg-warn-soft text-warn-ink",
  brand: "bg-brand-soft text-brand-ink",
  ok: "bg-ok-soft text-ok-ink",
} as const;

type BannerProps = {
  tone?: keyof typeof tones;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
};

export function Banner({ tone = "neutral", icon, action, className, children }: BannerProps) {
  return (
    <div
      role={tone === "bad" ? "alert" : "status"}
      className={clsx(
        "flex items-center gap-2.5 rounded-md px-3 py-2.5 text-13 [&_b]:font-semibold",
        tones[tone],
        className,
      )}
    >
      {icon}
      <div className="min-w-0 flex-1">{children}</div>
      {action}
    </div>
  );
}
