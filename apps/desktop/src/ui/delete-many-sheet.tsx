import type { ReactNode } from "react";

import { plural } from "@/lib/format";

import { ConfirmSheet } from "./confirm-sheet";

const SHOWN = 6;

type DeleteManySheetProps = {
  /** What goes, by name; empty while closed. */
  names: string[];
  /** Singular, as `plural` takes it: "image". */
  noun: string;
  onCancel: () => void;
  onConfirm: () => void;
  /** What deleting means for this kind of thing. */
  children: ReactNode;
};

/** Asks before deleting several things at once, naming them. */
export function DeleteManySheet({
  names,
  noun,
  onCancel,
  onConfirm,
  children,
}: DeleteManySheetProps) {
  const what = names.length === 1 ? (names[0] ?? noun) : plural(names.length, noun);
  const rest = names.length - SHOWN;
  return (
    <ConfirmSheet
      open={names.length > 0}
      onOpenChange={(open) => (open ? undefined : onCancel())}
      title={`Delete ${what}?`}
      action={`Delete ${names.length === 1 ? noun : what}`}
      onConfirm={onConfirm}
    >
      {names.length > 1 ? (
        <span className="mb-2 block font-mono text-mono-12">
          {names.slice(0, SHOWN).join(", ")}
          {rest > 0 ? ` and ${rest} more` : ""}
        </span>
      ) : null}
      {children}
    </ConfirmSheet>
  );
}
