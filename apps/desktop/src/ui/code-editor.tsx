import { type Extension, Prec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import clsx from "clsx";
import { basicSetup } from "codemirror";
import { useEffect, useEffectEvent, useRef } from "react";

const theme = EditorView.theme({
  "&": { height: "100%", fontSize: "12.5px", backgroundColor: "var(--bg)", color: "var(--ink)" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "var(--font-mono)", lineHeight: "20px" },
  ".cm-content": { padding: "10px 0", caretColor: "var(--ink)" },
  ".cm-gutters": {
    backgroundColor: "var(--panel-solid)",
    color: "var(--ink-4)",
    borderRight: "0.5px solid var(--line)",
  },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--ink-2)" },
  ".cm-activeLine": { backgroundColor: "transparent" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
    backgroundColor: "var(--select) !important",
  },
  ".cm-cursor": { borderLeftColor: "var(--ink)" },
  ".cm-tooltip": {
    border: "0",
    borderRadius: "9px",
    boxShadow: "var(--shadow-3)",
    backgroundColor: "var(--raised)",
    overflow: "hidden",
  },
  ".cm-tooltip-autocomplete > ul > li": { padding: "3px 8px", fontFamily: "var(--font-mono)" },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
    backgroundColor: "var(--brand-600)",
    color: "white",
  },
  ".cm-matchingBracket": { backgroundColor: "var(--brand-soft)", outline: "none" },
});

type CodeEditorProps = {
  value: string;
  onChange: (value: string) => void;
  /** ⌘↵: runs the selection when there is one, otherwise everything. */
  onRun?: (code: string) => void;
  /** Language, highlighting and completion for this editor. */
  extensions: Extension[];
  label: string;
  className?: string;
};

/** A CodeMirror editor that follows the app's tokens in light and dark. */
export function CodeEditor({
  value,
  onChange,
  onRun,
  extensions,
  label,
  className,
}: CodeEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const changed = useEffectEvent(onChange);
  const run = useEffectEvent((code: string) => onRun?.(code));
  const initial = useEffectEvent(() => value);
  useEffect(() => {
    if (!host.current) {
      return;
    }
    const editor = new EditorView({
      parent: host.current,
      doc: initial(),
      extensions: [
        Prec.highest(
          keymap.of([
            {
              key: "Mod-Enter",
              run: (target) => {
                const { from, to } = target.state.selection.main;
                run(from === to ? target.state.doc.toString() : target.state.sliceDoc(from, to));
                return true;
              },
            },
          ]),
        ),
        basicSetup,
        theme,
        EditorView.contentAttributes.of({ "aria-label": label }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            changed(update.state.doc.toString());
          }
        }),
        ...extensions,
      ],
    });
    view.current = editor;
    return () => {
      editor.destroy();
      view.current = null;
    };
  }, [extensions, label]);
  useEffect(() => {
    const editor = view.current;
    if (editor && editor.state.doc.toString() !== value) {
      editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value } });
    }
  }, [value]);
  return <div ref={host} className={clsx("min-h-0 overflow-hidden", className)} />;
}
