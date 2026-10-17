import type { Extension } from "@codemirror/state";

/** The languages `CodeEditor` can highlight. Add one by adding its loader below. */
export type Language = "yaml";

const LANGUAGES = {
  yaml: () => import("@codemirror/lang-yaml").then((module) => module.yaml()),
};

export type Editor = { setValue: (value: string) => void; destroy: () => void };

type Options = {
  parent: HTMLElement;
  doc: string;
  language: Language | undefined;
  /** Language, highlighting or completion the caller builds itself, such as SQL with a schema. */
  extensions: Extension[];
  readOnly: boolean;
  label: string;
  onChange: (value: string) => void;
  /** ⌘↵: gets the selection when there is one, otherwise everything. */
  onRun: ((code: string) => void) | undefined;
};

/** Builds a CodeMirror editor, importing CodeMirror only now. Syntax colours are design tokens. */
export async function createEditor({
  parent,
  doc,
  language,
  extensions,
  readOnly,
  label,
  onChange,
  onRun,
}: Options): Promise<Editor> {
  const [
    { EditorView, basicSetup },
    { EditorState, Prec },
    { keymap },
    { HighlightStyle, syntaxHighlighting },
    { tags },
  ] = await Promise.all([
    import("codemirror"),
    import("@codemirror/state"),
    import("@codemirror/view"),
    import("@codemirror/language"),
    import("@lezer/highlight"),
  ]);
  const grammar = language ? await LANGUAGES[language]() : [];
  const highlight = HighlightStyle.define([
    {
      tag: [tags.propertyName, tags.definition(tags.propertyName), tags.keyword],
      color: "var(--brand-ink)",
    },
    { tag: [tags.string, tags.special(tags.string)], color: "var(--ok-ink)" },
    { tag: [tags.number, tags.bool, tags.null, tags.atom], color: "var(--warn-ink)" },
    { tag: [tags.comment, tags.meta], color: "var(--ink-3)", fontStyle: "italic" },
    { tag: tags.invalid, color: "var(--bad-ink)" },
  ]);
  const theme = EditorView.theme({
    "&": {
      color: "var(--ink)",
      backgroundColor: "transparent",
      fontSize: "12.5px",
      height: "100%",
    },
    "&.cm-focused": { outline: "none" },
    ".cm-scroller": { fontFamily: "var(--font-mono)", lineHeight: "1.6" },
    ".cm-gutters": { backgroundColor: "transparent", color: "var(--ink-4)", border: "none" },
    ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "var(--hover)" },
    ".cm-cursor": { borderLeftColor: "var(--ink)" },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
      backgroundColor: "var(--select)",
    },
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
  const run = keymap.of([
    {
      key: "Mod-Enter",
      run: (target) => {
        const { from, to } = target.state.selection.main;
        onRun?.(from === to ? target.state.doc.toString() : target.state.sliceDoc(from, to));
        return onRun !== undefined;
      },
    },
  ]);
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [
        Prec.highest(run),
        basicSetup,
        grammar,
        ...extensions,
        theme,
        syntaxHighlighting(highlight),
        EditorState.readOnly.of(readOnly),
        EditorView.contentAttributes.of({ "aria-label": label }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChange(update.state.doc.toString());
          }
        }),
      ],
    }),
  });
  return {
    setValue: (value) => {
      if (view.state.doc.toString() !== value) {
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
      }
    },
    destroy: () => view.destroy(),
  };
}
