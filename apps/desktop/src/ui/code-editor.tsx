import clsx from "clsx";
import { useEffect, useEffectEvent, useRef } from "react";

import { createEditor, type Editor, type Language } from "./code-editor-setup";

type CodeEditorProps = {
  value: string;
  onChange?: (value: string) => void;
  language?: Language;
  readOnly?: boolean;
  label: string;
  className?: string;
};

/**
 * CodeMirror 6 with Containeria's tokens, loaded on first use so it stays out of the startup
 * bundle. Uncontrolled inside; follows `value` when it changes outside.
 */
export function CodeEditor({
  value,
  onChange,
  language,
  readOnly = false,
  label,
  className,
}: CodeEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<Editor | null>(null);
  const changed = useEffectEvent((next: string) => onChange?.(next));
  const initial = useEffectEvent(() => value);

  useEffect(() => {
    let created: Editor | undefined;
    let mounted = true;
    const parent = host.current;
    if (parent) {
      createEditor({
        parent,
        doc: initial(),
        language,
        readOnly,
        label,
        onChange: (next) => changed(next),
      })
        .then((made) => {
          if (mounted) {
            created = made;
            editor.current = made;
          } else {
            made.destroy();
          }
        })
        .catch(() => undefined);
    }
    return () => {
      mounted = false;
      editor.current = null;
      created?.destroy();
    };
  }, [language, readOnly, label]);

  useEffect(() => {
    editor.current?.setValue(value);
  }, [value]);

  return (
    <div
      ref={host}
      className={clsx("selectable min-h-0 overflow-hidden rounded-md bg-fill hairline", className)}
    />
  );
}
