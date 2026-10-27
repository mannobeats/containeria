import type { ReactNode } from "react";

/** Covers the window while a file it takes is dragged over it. */
export function DropOverlay({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="pointer-events-none fixed inset-3 z-50 flex flex-col items-center justify-center gap-2.5 rounded-lg border-2 border-dashed border-brand bg-brand-soft text-brand-ink animate-fade [&_.tabler-icon]:size-7">
      {icon}
      <b>{children}</b>
    </div>
  );
}
