import clsx from "clsx";
import type { ReactNode } from "react";

type SectionProps = { title?: string; note?: ReactNode; children: ReactNode };

/** A titled group of rows on one rounded surface, like System Settings. */
export function SettingsSection({ title, note, children }: SectionProps) {
  return (
    <section className="mt-6 first:mt-0">
      {title ? <h2 className="m-0 mb-2 ml-0.5 text-13 font-semibold text-ink">{title}</h2> : null}
      <div className="rounded-lg bg-surface shadow-[0_0_0_0.5px_light-dark(oklch(0_0_0/0.1),oklch(1_0_0/0.1))]">
        {children}
      </div>
      {note ? <p className="m-0 mt-2 ml-0.5 text-12 text-ink-3">{note}</p> : null}
    </section>
  );
}

type RowProps = {
  label: ReactNode;
  hint?: ReactNode;
  /** Wide controls such as sliders go under the label instead of beside it. */
  block?: boolean;
  children: ReactNode;
};

export function SettingsRow({ label, hint, block = false, children }: RowProps) {
  return (
    <div
      className={clsx(
        "flex gap-4 border-t-[0.5px] border-line px-3.5 first:border-t-0",
        block ? "flex-col gap-2.5 py-3" : "min-h-11 items-center py-[9px]",
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-13 text-ink">{label}</span>
        {hint ? <span className="text-12 text-pretty text-ink-3">{hint}</span> : null}
      </div>
      <div className={clsx("flex items-center gap-1.5", !block && "shrink-0 justify-end")}>
        {children}
      </div>
    </div>
  );
}
