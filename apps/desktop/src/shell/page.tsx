import clsx from "clsx";
import type { ReactNode } from "react";

import { useUi } from "./ui-store";

type PageProps = {
  crumbs: ReactNode;
  tools?: ReactNode;
  /** Flush pages manage their own scrolling, like a terminal or a data grid. */
  flush?: boolean;
  children: ReactNode;
};

/** Every screen: a draggable 52px top bar with breadcrumbs and tools, then the content. */
export function Page({ crumbs, tools, flush = false, children }: PageProps) {
  const collapsed = useUi((state) => state.sidebarCollapsed);
  return (
    <>
      <header
        data-tauri-drag-region
        className={clsx(
          "flex h-[52px] shrink-0 items-center gap-2 border-b-[0.5px] border-line pr-3 transition-[padding] duration-220 ease-out",
          collapsed ? "pl-24" : "pl-5",
        )}
      >
        <nav
          aria-label="Breadcrumbs"
          className="flex min-w-0 items-center gap-1 text-13 text-ink-3"
        >
          {crumbs}
        </nav>
        {tools ? <div className="ml-auto flex items-center gap-1">{tools}</div> : null}
      </header>
      <main
        className={clsx(
          "relative min-h-0 flex-1",
          flush ? "flex flex-col overflow-hidden" : "overflow-auto",
        )}
      >
        {children}
      </main>
    </>
  );
}

export function Crumb({ children }: { children: ReactNode }) {
  return <b className="truncate px-1 py-0.5 text-14 font-semibold text-ink">{children}</b>;
}
