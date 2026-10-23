import { IconAlertCircle, IconFilterOff, IconTable } from "@tabler/icons-react";
import type { UseQueryResult } from "@tanstack/react-query";
import clsx from "clsx";
import { useEffect, useEffectEvent, useState } from "react";

import type { Column, RowPage, ServerInfo, Table, Value } from "@/lib/ipc/bindings";
import { errorMessage } from "@/lib/ipc/errors";
import { useIdSet } from "@/lib/use-id-set";
import { Banner } from "@/ui/banner";
import { Button } from "@/ui/button";
import { EmptyState } from "@/ui/empty-state";

import { useRows } from "../api";
import { cellText, pendingSummary, tableKey, tableRef } from "../model";
import { tableTab, useOpenTab } from "../tabs";
import { DEFAULT_VIEW, type GridView, useWorkspace } from "../workspace-store";
import { DataGrid } from "./data-grid";
import { FilterBar } from "./filter-bar";
import { GridFooter } from "./grid-footer";
import { type CellPosition, gridRows } from "./grid-model";
import { PendingBar } from "./pending-bar";
import { ReviewSheet } from "./review-sheet";
import { RowInspector } from "./row-inspector";
import { StructureView } from "./structure-view";
import { useTableEdits } from "./use-table-edits";

/** The grid view's settings for one table, kept while its tab is open. */
function useGridView(connection: string, table: Table) {
  const key = `${connection}|${tableKey(table)}`;
  const view = useWorkspace((state) => state.views[key]) ?? DEFAULT_VIEW;
  const setView = useWorkspace((state) => state.setView);
  return [view, (change: Partial<GridView>) => setView(key, change)] as const;
}

/** ⌘S commits, from anywhere in the table. */
function useCommitShortcut(enabled: boolean, commit: () => void) {
  const run = useEffectEvent(commit);
  useEffect(() => {
    if (!enabled) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey && event.key.toLowerCase() === "s") {
        event.preventDefault();
        run();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}

/** Follows a foreign key: opens the referenced table filtered to the row it points at. */
function useFollowReference(connection: string) {
  const open = useOpenTab(connection);
  const setView = useWorkspace((state) => state.setView);
  return (column: Column, value: Value) => {
    const target = column.references;
    if (!target) {
      return;
    }
    const key = target.schema ? `${target.schema}.${target.table}` : target.table;
    setView(`${connection}|${key}`, {
      filters: [{ column: target.column, op: "equals", value: cellText(value) }],
      page: 0,
      structure: false,
    });
    open(tableTab(key));
  };
}

/** Why there are no rows to show: the read failed, the filters match nothing, or the table is empty. */
function NoRows({
  table,
  view,
  page,
  onClear,
}: {
  table: Table;
  view: GridView;
  page: UseQueryResult<RowPage>;
  onClear: () => void;
}) {
  if (page.isError) {
    return (
      <EmptyState
        art={<IconAlertCircle className="size-7 text-bad" aria-hidden />}
        title="The rows couldn't be read"
      >
        {errorMessage(page.error)}
      </EmptyState>
    );
  }
  if (!page.data) {
    return null;
  }
  const filtered = view.filters.length > 0;
  return (
    <EmptyState
      art={
        filtered ? (
          <IconFilterOff className="size-7" aria-hidden />
        ) : (
          <IconTable className="size-7" aria-hidden />
        )
      }
      title={filtered ? "No rows match these filters" : `${table.name} is empty`}
      actions={filtered ? <Button onClick={onClear}>Clear filters</Button> : null}
    />
  );
}

/** The inspector's previous and next row, from the active cell or the first row. */
function stepRow(active: CellPosition | null, direction: 1 | -1, count: number): CellPosition {
  return active
    ? { ...active, row: Math.min(count - 1, Math.max(0, active.row + direction)) }
    : { row: 0, column: 0 };
}

type GridAreaProps = {
  info: ServerInfo;
  table: Table;
  view: GridView;
  setView: (change: Partial<GridView>) => void;
  page: UseQueryResult<RowPage>;
  edits: ReturnType<typeof useTableEdits>;
};

/** Filters on one cell's value, replacing any filter already on its column. */
function filterByValue(filters: GridView["filters"], column: Column, value: Value | null) {
  return [
    ...filters.filter((filter) => filter.column !== column.name),
    value === null
      ? { column: column.name, op: "isNull" as const, value: null }
      : { column: column.name, op: "equals" as const, value: cellText(value) },
  ];
}

/** The grid with its footer, the staged-changes bar and the optional row inspector. */
function GridArea({ info, table, view, setView, page, edits }: GridAreaProps) {
  const selection = useIdSet();
  const [active, setActive] = useState<CellPosition | null>(null);
  const follow = useFollowReference(info.id);
  const offset = view.page * view.size;
  const columns = page.data?.columns ?? table.columns;
  const rows = gridRows(columns, page.data?.rows ?? [], edits.pending, offset);
  const editable = page.data?.readOnlyReason === null;
  const step = (direction: 1 | -1) => setActive(stepRow(active, direction, rows.length));
  const writes = editable
    ? {
        onEdit: edits.edit,
        onDelete: (row: (typeof rows)[number]) => edits.toggleDelete([row]),
        onAddRow: edits.addRow,
      }
    : {};
  const inspector = view.inspector ? (
    <RowInspector
      table={table.name}
      columns={columns}
      row={active ? rows[active.row] : undefined}
      onStep={step}
      onClose={() => setView({ inspector: false })}
    />
  ) : null;
  return (
    <div
      className={clsx(
        "grid min-h-0 flex-1",
        inspector ? "grid-cols-[minmax(0,1fr)_300px]" : "grid-cols-1",
      )}
    >
      <div className="relative flex min-h-0 min-w-0 flex-col">
        {rows.length > 0 ? (
          <DataGrid
            key={tableKey(table)}
            label={`${table.name} rows`}
            columns={columns}
            rows={rows}
            offset={offset}
            sort={view.sort}
            onSort={(sort) => setView({ sort, page: 0 })}
            selected={selection.ids}
            onToggleRow={(row) => selection.toggle(row.id)}
            active={active}
            onActive={setActive}
            onEdit={writes.onEdit}
            onJump={follow}
            table={table.name}
            onFilter={(column, value) =>
              setView({ filters: filterByValue(view.filters, column, value), page: 0 })
            }
            onDelete={writes.onDelete}
          />
        ) : (
          <NoRows
            table={table}
            view={view}
            page={page}
            onClear={() => setView({ filters: [], page: 0 })}
          />
        )}
        <GridFooter
          page={page.data}
          view={view}
          onView={setView}
          selected={selection.ids.size}
          onDeleteSelected={() => {
            edits.toggleDelete(rows.filter((row) => selection.ids.has(row.id)));
            selection.clear();
          }}
          onAddRow={writes.onAddRow}
        />
        <PendingBar
          count={edits.count}
          table={table.name}
          summary={pendingSummary(edits.pending)}
          committing={edits.committing}
          onReview={edits.openReview}
          onDiscard={edits.discard}
          onCommit={edits.commit}
        />
      </div>
      {inspector}
    </div>
  );
}

/** One table: filters, the grid with staged edits, paging, and its structure. */
export function TableView({ info, table }: { info: ServerInfo; table: Table }) {
  const [view, setView] = useGridView(info.id, table);
  const request = {
    table: tableRef(table),
    filters: view.filters,
    sort: view.sort,
    limit: view.size,
    offset: view.page * view.size,
  };
  const page = useRows(info.id, view.structure ? null : request);
  const edits = useTableEdits(info.id, table);
  useCommitShortcut(edits.count > 0, edits.commit);
  const reason = view.structure || !info.capabilities.editRows ? null : page.data?.readOnlyReason;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <FilterBar info={info} table={table} view={view} onView={setView} />
      {reason ? (
        <Banner className="mx-3 mt-2" icon={<IconAlertCircle aria-hidden />}>
          {reason}
        </Banner>
      ) : null}
      {view.structure ? (
        <StructureView table={table} />
      ) : (
        <GridArea
          info={info}
          table={table}
          view={view}
          setView={setView}
          page={page}
          edits={edits}
        />
      )}
      <ReviewSheet
        sql={edits.review}
        documents={!info.capabilities.sql}
        onClose={edits.closeReview}
        onCommit={edits.commit}
        committing={edits.committing}
      />
    </div>
  );
}
