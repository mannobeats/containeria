import clsx from "clsx";
import type { ReactNode } from "react";

type EmptyStateProps = {
  art?: ReactNode;
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
  className?: string;
};

export function EmptyState({ art, title, children, actions, className }: EmptyStateProps) {
  return (
    <div
      className={clsx(
        "flex flex-col items-center justify-center gap-2.5 px-6 py-16 text-center text-ink-3",
        className,
      )}
    >
      {art ? <div className="mb-1">{art}</div> : null}
      <h2 className="m-0 text-16 font-semibold text-ink">{title}</h2>
      {children ? <div className="m-0 max-w-[44ch] text-pretty">{children}</div> : null}
      {actions ? <div className="mt-1.5 flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}
