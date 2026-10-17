/** Clicks on these act for themselves, not for the row they sit in. */
const OWN_CONTROLS = "a, button, input, label, select, textarea, [role='menuitem']";

/**
 * A ref callback for a table whose rows open on a click anywhere in them: the click goes to the
 * row's `data-row-link`. A stretched `::after` overlay can't do this: WebKit doesn't contain one
 * in a table row, so every overlay covers the whole table.
 */
export function openRowOnClick(table: HTMLTableElement | null) {
  if (!table) {
    return;
  }
  const open = (event: MouseEvent) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target || target.closest(OWN_CONTROLS)) {
      return;
    }
    target.closest("tr")?.querySelector<HTMLElement>("[data-row-link]")?.click();
  };
  table.addEventListener("click", open);
  return () => table.removeEventListener("click", open);
}
