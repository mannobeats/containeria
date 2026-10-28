/** On the link in a table row's first cell; with `data-row-link`, a click anywhere opens it. */
export const rowLink = "flex min-w-0 items-center gap-2 text-inherit no-underline outline-none";

/**
 * Around a row's action buttons: shown while the row is hovered or focused, and while one of them
 * has its menu open, since the pointer and focus then sit in the menu outside the row.
 */
export const rowActions =
  "inline-flex gap-0.5 opacity-0 transition-opacity duration-140 group-focus-within/row:opacity-100 group-hover/row:opacity-100 has-data-[state=open]:opacity-100";
