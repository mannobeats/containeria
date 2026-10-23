import { useEffect, useEffectEvent, useState } from "react";

import { useIdSet } from "./use-id-set";

export type Selection = ReturnType<typeof useSelection>;

/**
 * A Finder-style selection over the rows shown, in their order: ⌘-click toggles a row, ⇧-click
 * selects up to it, the header box takes them all. Only `selectable` ids count, so a row that's
 * filtered out or still in use is never acted on.
 */
export function useSelection(selectable: string[]) {
  const picked = useIdSet();
  const [anchor, setAnchor] = useState<string | null>(null);
  const chosen = selectable.filter((id) => picked.ids.has(id));
  const chosenIds = new Set(chosen);
  const toggle = (id: string) => {
    picked.toggle(id);
    setAnchor(id);
  };
  const extend = (id: string) => {
    const from = anchor === null ? -1 : selectable.indexOf(anchor);
    const to = selectable.indexOf(id);
    if (from < 0 || to < 0) {
      toggle(id);
      return;
    }
    picked.set(selectable.slice(Math.min(from, to), Math.max(from, to) + 1), true);
  };
  let all: boolean | "indeterminate" = "indeterminate";
  if (chosen.length === 0) {
    all = false;
  } else if (chosen.length === selectable.length) {
    all = true;
  }
  return {
    chosen,
    all,
    has: (id: string) => chosenIds.has(id),
    toggle,
    setAll: (on: boolean) => picked.set(selectable, on),
    /** Sets rows on or off; one row set becomes where a ⇧-click range starts. */
    set: (targets: string[], on: boolean) => {
      picked.set(targets, on);
      if (targets.length === 1) {
        setAnchor(targets[0] ?? null);
      }
    },
    clear: picked.clear,
    /** What a ⌘- or ⇧-click on a row does instead of opening it. */
    click: (id: string, event: { metaKey: boolean; shiftKey: boolean }) => {
      if (event.shiftKey) {
        extend(id);
      } else if (event.metaKey) {
        toggle(id);
      }
    },
  };
}

/** ⌘⌫ deletes the selection and Esc lets go of it, unless something else has the keyboard. */
export function useSelectionKeys(selection: Selection, onDelete: () => void) {
  const handle = useEffectEvent((event: KeyboardEvent) => {
    const busy =
      (event.target instanceof HTMLElement &&
        event.target.closest("input, textarea, [contenteditable]")) ||
      document.querySelector("[role='dialog'], [role='menu']");
    if (busy || selection.chosen.length === 0) {
      return;
    }
    if (event.key === "Escape") {
      selection.clear();
    } else if (event.metaKey && event.key === "Backspace") {
      event.preventDefault();
      onDelete();
    }
  });
  useEffect(() => {
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, []);
}
