import { type RefObject, useEffect } from "react";

/** `/` focuses the list's search field, unless the user is already typing somewhere. */
export function useSlashToSearch(input: RefObject<HTMLInputElement | null>) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const typing =
        event.target instanceof HTMLElement &&
        event.target.closest("input, textarea, [contenteditable]");
      if (event.key === "/" && !typing) {
        event.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [input]);
}
