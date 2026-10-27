import clsx from "clsx";
import type { ReactNode } from "react";

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={clsx(
        "inline-flex h-[18px] min-w-[18px] items-center justify-center gap-px rounded-xs bg-fill px-1 font-sans text-11 font-medium leading-none text-ink-3 hairline",
        className,
      )}
    >
      {children}
    </kbd>
  );
}
