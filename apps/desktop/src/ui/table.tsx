import clsx from "clsx";
import type { ReactNode } from "react";

export type Column<Row> = {
  header: string;
  /** Hide the header text from sight but keep it for screen readers, as for an actions column. */
  hiddenHeader?: boolean;
  align?: "left" | "right";
  /** A Tailwind width class for the `col`, like `w-[96px]`. */
  width?: string;
  cell: (row: Row) => ReactNode;
};

type TableProps<Row> = {
  columns: Column<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string;
  /** Greys out rows that are done or stopped, like a completed job pod. */
  muted?: (row: Row) => boolean;
  label: string;
};

/** The list table: sticky header, hairline rows, actions revealed on hover via `group/row`. */
export function Table<Row>({ columns, rows, rowKey, muted, label }: TableProps<Row>) {
  return (
    <table
      aria-label={label}
      className="w-full table-fixed border-separate border-spacing-0 text-13"
    >
      <colgroup>
        {columns.map((column) => (
          <col key={column.header} className={column.width} />
        ))}
      </colgroup>
      <thead>
        <tr>
          {columns.map((column) => (
            <th
              key={column.header}
              className={clsx(
                "sticky top-0 z-[2] h-[30px] border-b-[0.5px] border-line bg-bg px-2.5 text-12 font-medium text-ink-3 first:pl-5 last:pr-5",
                column.align === "right" ? "text-right" : "text-left",
              )}
            >
              <span className={column.hiddenHeader ? "sr-only" : undefined}>{column.header}</span>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr
            key={rowKey(row)}
            className={clsx(
              "group/row relative h-9 transition-colors duration-140 hover:bg-hover",
              muted?.(row) && "[&>td]:text-ink-3",
            )}
          >
            {columns.map((column) => (
              <td
                key={column.header}
                className={clsx(
                  "max-w-0 truncate border-b-[0.5px] border-line px-2.5 text-ink-2 first:pl-5 last:pr-5",
                  column.align === "right" && "text-right tabular",
                )}
              >
                {column.cell(row)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
