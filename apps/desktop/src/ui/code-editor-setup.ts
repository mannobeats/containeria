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
  readOnly: boolean;
  label: string;
  onChange: (value: string) => void;
};

/** Builds a CodeMirror editor, importing CodeMirror only now. Syntax colours are design tokens. */
export async function createEditor({
  parent,
  doc,
  language,
  readOnly,
  label,
  onChange,
}: Options): Promise<Editor> {
  const [
    { EditorView, basicSetup },
    { EditorState },
    { HighlightStyle, syntaxHighlighting },
    { tags },
  ] = await Promise.all([
    import("codemirror"),
    import("@codemirror/state"),
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
  });
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [
        basicSetup,
        grammar,
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
