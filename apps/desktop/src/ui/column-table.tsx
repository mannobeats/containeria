import clsx from "clsx";
import type { ReactNode } from "react";

import { ContextMenu, type MenuEntry } from "./menu";
import { HeadRow, Row, Table } from "./table";

export type Column<Item> = {
  header: string;
  /** Hide the header text from sight but keep it for screen readers, as for an actions column. */
  hiddenHeader?: boolean;
  align?: "left" | "right";
  /** A Tailwind width class for the `col`, like `w-[96px]`. */
  width?: string;
  cell: (item: Item) => ReactNode;
};

type ColumnTableProps<Item> = {
  columns: Column<Item>[];
  rows: Item[];
  rowKey: (item: Item) => string;
  /** Greys out rows that are done or stopped, like a completed job pod. */
  muted?: (item: Item) => boolean;
  /** The row's right-click menu. Pass the same entries to the row's ⋯ button, if it has one. */
  menu?: (item: Item) => MenuEntry[];
  label: string;
};

/** A `Table` described by its columns, for lists whose rows all look alike. */
export function ColumnTable<Item>({
  columns,
  rows,
  rowKey,
  muted,
  menu,
  label,
}: ColumnTableProps<Item>) {
  return (
    <Table label={label}>
      <colgroup>
        {columns.map((column) => (
          <col key={column.header} className={column.width} />
        ))}
      </colgroup>
      <HeadRow>
        {columns.map((column) => (
          <th key={column.header} className={column.align === "right" ? "text-right!" : undefined}>
            <span className={column.hiddenHeader ? "sr-only" : undefined}>{column.header}</span>
          </th>
        ))}
      </HeadRow>
      <tbody>
        {rows.map((item) => {
          const row = (
            <Row key={rowKey(item)} dim={muted?.(item) ?? false}>
              {columns.map((column) => (
                <td
                  key={column.header}
                  className={clsx(
                    "max-w-0 truncate text-ink-2",
                    column.align === "right" && "text-right tabular",
                  )}
                >
                  {column.cell(item)}
                </td>
              ))}
            </Row>
          );
          return menu ? (
            <ContextMenu key={rowKey(item)} entries={menu(item)}>
              {row}
            </ContextMenu>
          ) : (
            row
          );
        })}
      </tbody>
    </Table>
  );
}
