import { useState } from "react";
import { toast } from "sonner";

import type { Column, Table } from "@/lib/ipc/bindings";
import { errorMessage, isCommandError } from "@/lib/ipc/errors";

import { useCommit, usePreview } from "../api";
import {
  EMPTY_PENDING,
  type Pending,
  pendingCount,
  tableKey,
  tableRef,
  toChangeSet,
  withEdit,
  withRowsDeleted,
} from "../model";
import { useWorkspace } from "../workspace-store";
import type { GridRow } from "./grid-model";

/** Staged edits for one table and what to do with them: edit, add, delete, review, commit. */
export function useTableEdits(connection: string, table: Table) {
  const key = `${connection}|${tableKey(table)}`;
  const pending = useWorkspace((state) => state.pending[key]) ?? EMPTY_PENDING;
  const setPending = useWorkspace((state) => state.setPending);
  const change = (update: (current: Pending) => Pending) => setPending(key, update);
  const commit = useCommit(connection);
  const preview = usePreview(connection);
  const [review, setReview] = useState<string | undefined>();
  const changes = () => toChangeSet(pending, tableRef(table));
  return {
    pending,
    count: pendingCount(pending),
    committing: commit.isPending,
    review,
    edit: (row: GridRow, column: Column, text: string | null) => {
      if (row.added !== null) {
        const index = row.added;
        change((current) => ({
          ...current,
          added: current.added.map((values, position) =>
            position === index ? { ...values, [column.name]: text } : values,
          ),
        }));
      } else if (row.key) {
        const key = row.key;
        const before = row.edited[column.name] ?? row.values[table.columns.indexOf(column)] ?? null;
        change((current) => withEdit(current, key, column.name, before, text));
      }
    },
    addRow: () => change((current) => ({ ...current, added: [{}, ...current.added] })),
    toggleDelete: (rows: GridRow[]) => change((current) => withRowsDeleted(current, rows)),
    discard: () => change(() => EMPTY_PENDING),
    openReview: () =>
      preview.mutate(changes(), {
        onSuccess: setReview,
        onError: (error) =>
          toast.error("The changes don't fit the table", { description: errorMessage(error) }),
      }),
    closeReview: () => setReview(undefined),
    commit: () =>
      commit.mutate(changes(), {
        onSuccess: (rows) => {
          change(() => EMPTY_PENDING);
          setReview(undefined);
          toast.success(
            `Committed ${rows.toLocaleString("en-US")} ${rows === 1 ? "row" : "rows"} to ${table.name}`,
          );
        },
        onError: (error) =>
          toast.error(
            isCommandError(error) && error.kind === "readOnly"
              ? `${table.name} is read-only`
              : "Nothing was committed",
            {
              description: errorMessage(error),
            },
          ),
      }),
  };
}
