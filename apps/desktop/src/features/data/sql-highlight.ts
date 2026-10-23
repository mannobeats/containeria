import { PostgreSQL } from "@codemirror/lang-sql";
import { highlightCode, tagHighlighter, tags } from "@lezer/highlight";

/** The SQL palette as utility classes, shared by the editor and every static snippet. */
export const sqlHighlighter = tagHighlighter([
  { tag: [tags.keyword, tags.operatorKeyword, tags.bool, tags.null], class: "text-sx-kw" },
  { tag: [tags.string, tags.special(tags.string)], class: "text-sx-str" },
  { tag: tags.number, class: "text-sx-num" },
  { tag: [tags.function(tags.variableName), tags.standard(tags.name)], class: "text-sx-fn" },
  { tag: [tags.typeName, tags.name, tags.propertyName], class: "text-sx-col" },
  { tag: [tags.lineComment, tags.blockComment], class: "text-sx-com italic" },
  { tag: [tags.operator, tags.punctuation], class: "text-sx-op" },
]);

/** A piece of SQL; `from` is its offset, which also identifies it. */
export type SqlSpan = { from: number; text: string; className: string };

/** Splits SQL into highlighted pieces, without a live editor. */
export function highlightSql(sql: string): SqlSpan[] {
  const spans: SqlSpan[] = [];
  let from = 0;
  const put = (text: string, className: string) => {
    spans.push({ from, text, className });
    from += text.length;
  };
  highlightCode(sql, PostgreSQL.language.parser.parse(sql), sqlHighlighter, put, () =>
    put("\n", ""),
  );
  return spans;
}
