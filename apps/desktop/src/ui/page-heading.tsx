import type { ReactNode } from "react";

/** A list page's title with its primary action, then the line that answers the page's question. */
export function PageHeading({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2.5 px-5 pt-[18px] pb-4">
      <div className="flex items-center gap-3">
        <h1 className="m-0 mr-auto text-20 font-semibold tracking-[-0.012em] text-balance text-ink">
          {title}
        </h1>
        {action}
      </div>
      {children}
    </section>
  );
}

/** The one-sentence answer under a heading. */
export function Lede({ children }: { children: ReactNode }) {
  return (
    <p className="m-0 max-w-[78ch] text-14 text-pretty text-ink-2 [&_b]:font-semibold [&_b]:text-ink">
      {children}
    </p>
  );
}
