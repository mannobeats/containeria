import { IconChevronRight } from "@tabler/icons-react";
import { Link } from "@tanstack/react-router";

import type { Section } from "./sections";

/** The link back to the list a detail page belongs to, then the chevron before its name. */
export function ParentCrumb({ to, label }: { to: Section["to"]; label: string }) {
  return (
    <>
      <Link
        to={to}
        className="rounded-[5px] px-1 py-0.5 font-medium text-ink-3 no-underline hover:bg-hover hover:text-ink"
      >
        {label}
      </Link>
      <IconChevronRight className="size-3.5 text-ink-4" aria-hidden />
    </>
  );
}
