import clsx from "clsx";
import { useState } from "react";

import type { Column, Value } from "@/lib/ipc/bindings";

import { cellText } from "../model";

/** One cell's value, drawn by type: NULL and booleans are set apart from text. */
export function CellValue({ value }: { value: Value }) {
  if (value === null) {
    return <span className="font-sans text-12 text-ink-4 italic">NULL</span>;
  }
  if (typeof value === "boolean") {
    return <span className={value ? "text-ok-ink" : "text-ink-3"}>{String(value)}</span>;
  }
  if (typeof value === "object") {
    return <span className="text-sx-str">{JSON.stringify(value)}</span>;
  }
  return <>{String(value)}</>;
}

type CellEditorProps = {
  column: Column;
  value: Value;
  onDone: (text: string | null | undefined) => void;
};

/**
 * Edits one cell in place. Enter saves (⌘↵ for long text), Escape cancels, an empty field on a
 * nullable column writes NULL only through ⌘⌫.
 */
export function CellEditor({ column, value, onDone }: CellEditorProps) {
  const [text, setText] = useState(() => cellText(value) ?? "");
  const [long] = useState(() => column.kind === "json" || text.length > 60 || text.includes("\n"));
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onDone(undefined);
    } else if (event.key === "Enter" && (!long || event.metaKey)) {
      event.preventDefault();
      onDone(text);
    } else if (event.key === "Backspace" && event.metaKey && column.nullable) {
      event.preventDefault();
      onDone(null);
    }
  };
  const shared = {
    autoFocus: true,
    value: text,
    "aria-label": `Edit ${column.name}`,
    spellCheck: false,
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setText(event.target.value),
    onKeyDown,
    onBlur: () => onDone(text),
    className: clsx(
      "absolute top-0 left-0 z-[6] w-full border-0 bg-surface px-[9px] font-mono text-mono-13 text-ink shadow-[inset_0_0_0_2px_var(--brand),var(--shadow-2)] outline-none",
      long
        ? "h-36 min-w-[340px] resize-none rounded-b-md py-1.5 leading-normal"
        : "h-full leading-[26px]",
    ),
  };
  return long ? <textarea {...shared} /> : <input {...shared} />;
}
