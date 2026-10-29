import clsx from "clsx";

/** `value` from 0 to 1, or `undefined` while the amount isn't known. */
export function Progress({
  value,
  label,
  className,
}: {
  value?: number | undefined;
  label: string;
  className?: string;
}) {
  const fraction = value === undefined ? undefined : Math.min(1, Math.max(0, value || 0));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={fraction === undefined ? undefined : Math.round(fraction * 100)}
      className={clsx("h-1 overflow-hidden rounded-xs bg-fill", className)}
    >
      <i
        className={clsx(
          "block h-full origin-left rounded-[inherit] bg-brand transition-transform duration-220 ease-out",
          fraction === undefined && "w-2/5 animate-indeterminate",
        )}
        style={fraction === undefined ? undefined : { transform: `scaleX(${fraction})` }}
      />
    </div>
  );
}

const meterTones = { neutral: "bg-ink-3", warn: "bg-warn", bad: "bg-bad" } as const;

/** A small gauge for a share of a limit. Decorative: show the number as text beside it. */
export function Meter({
  value,
  tone = "neutral",
}: {
  value: number;
  tone?: keyof typeof meterTones;
}) {
  return (
    <div aria-hidden className="relative h-1 w-14 overflow-hidden rounded-xs bg-fill">
      <i
        className={clsx(
          "absolute inset-0 origin-left rounded-[inherit] transition-transform duration-220 ease-out",
          meterTones[tone],
        )}
        style={{ transform: `scaleX(${Math.min(1, Math.max(0, value))})` }}
      />
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={clsx(
        "block h-2.5 animate-shimmer rounded-xs bg-[linear-gradient(90deg,var(--fill)_25%,var(--hover)_37%,var(--fill)_63%)] bg-size-[400%_100%]",
        className,
      )}
    />
  );
}
