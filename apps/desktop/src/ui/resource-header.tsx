import type { ReactNode } from "react";

type ResourceHeaderProps = {
  face: ReactNode;
  title: string;
  /** A line of facts, one `<span>` each. */
  meta: ReactNode;
  actions?: ReactNode;
};

/** The top of a detail page: the object's face, its name, a line of facts and its actions. */
export function ResourceHeader({ face, title, meta, actions }: ResourceHeaderProps) {
  return (
    <div className="flex min-w-0 shrink-0 items-center gap-3 px-5 pt-[18px] pb-3.5">
      {face}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <h1 className="m-0 truncate text-20 font-semibold tracking-[-0.012em] text-ink select-text">
          {title}
        </h1>
        <p className="m-0 flex min-w-0 flex-wrap items-center gap-x-3.5 gap-y-1 text-12 text-ink-3 [&>*]:inline-flex [&>*]:items-center [&>*]:gap-1">
          {meta}
        </p>
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}
