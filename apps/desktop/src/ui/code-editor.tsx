import type { Extension } from "@codemirror/state";
import clsx from "clsx";
import { useEffect, useEffectEvent, useRef } from "react";
import { createEditor, type Editor, type Language } from "./code-editor-setup";

const NO_EXTENSIONS: Extension[] = [];

type CodeEditorProps = {
  value: string;
  onChange?: (value: string) => void;
  /** ⌘↵: runs the selection when there is one, otherwise everything. */
  onRun?: (code: string) => void;
  language?: Language;
  /** Extra CodeMirror extensions; keep the array stable, a new one rebuilds the editor. */
  extensions?: Extension[];
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
  onRun,
  language,
  extensions = NO_EXTENSIONS,
  readOnly = false,
  label,
  className,
}: CodeEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<Editor | null>(null);
  const changed = useEffectEvent((next: string) => onChange?.(next));
  const ran = useEffectEvent((code: string) => onRun?.(code));
  const runnable = onRun !== undefined;
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
        extensions,
        readOnly,
        label,
        onChange: (next) => changed(next),
        onRun: runnable ? (code) => ran(code) : undefined,
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
  }, [language, extensions, readOnly, runnable, label]);

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
