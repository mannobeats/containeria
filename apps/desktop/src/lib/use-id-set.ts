import { useState } from "react";

/** A set of ids with add, remove and toggle, for selections and collapsed groups. */
export function useIdSet() {
  const [ids, setIds] = useState<ReadonlySet<string>>(() => new Set());
  const update = (change: (next: Set<string>) => void) =>
    setIds((current) => {
      const next = new Set(current);
      change(next);
      return next;
    });
  return {
    ids,
    set: (targets: string[], on: boolean) =>
      update((next) => {
        for (const id of targets) {
          if (on) {
            next.add(id);
          } else {
            next.delete(id);
          }
        }
      }),
    toggle: (id: string) =>
      update((next) => {
        if (!next.delete(id)) {
          next.add(id);
        }
      }),
    clear: () => setIds(new Set()),
  };
}
