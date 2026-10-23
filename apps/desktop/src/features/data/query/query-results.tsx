import { IconAlertCircle, IconCheck, IconCopy, IconLoader2, IconSql } from "@tabler/icons-react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { useState } from "react";
import { toast } from "sonner";

import type { Column, QueryResult } from "@/lib/ipc/bindings";
import { errorMessage } from "@/lib/ipc/errors";
import { Banner } from "@/ui/banner";
import { Button } from "@/ui/button";
import { EmptyState } from "@/ui/empty-state";
import { IconAction } from "@/ui/icon-action";
import { Kbd } from "@/ui/kbd";
import { EMPTY_PENDING } from "../model";
import { DataGrid } from "../table/data-grid";
import { asTsv, type CellPosition, gridRows } from "../table/grid-model";

type ResultsProps = {
  result: QueryResult | undefined;
  error: unknown;
  running: boolean;
  onCancel: () => void;
};

const asColumns = (result: QueryResult): Column[] =>
  result.columns.map((column) => ({
    ...column,
    nullable: true,
    primaryKey: false,
    references: null,
    default: null,
  }));

function Message({ result }: { result: QueryResult }) {
  const time = `${Math.round(result.elapsedMs ?? 0)} ms`;
  const text =
    result.affected === null
      ? `${result.rows.length.toLocaleString("en-US")} rows`
      : `${result.affected.toLocaleString("en-US")} rows affected`;
  return (
    <div className="flex h-[30px] items-center gap-2.5 border-b-[0.5px] border-line px-5 text-ink-2 [&_.tabler-icon]:size-3.5 [&_.tabler-icon]:text-ink-3">
      <IconCheck aria-hidden />
      <span className="flex-1 font-mono text-mono-12">
        {text}
        {result.truncated ? ", showing the first 5,000" : ""}
      </span>
      <span className="text-12 text-ink-3 tabular">{time}</span>
    </div>
  );
}

/** What the last run returned: rows, a count of changed rows, or the database's error. */
export function QueryResults({ result, error, running, onCancel }: ResultsProps) {
  const [active, setActive] = useState<CellPosition | null>(null);
  if (running) {
    return (
      <div className="flex h-9 items-center gap-2 border-b-[0.5px] border-line px-3 text-12 text-ink-3">
        <IconLoader2 className="size-3.5 animate-spin" aria-hidden />
        Running…
        <Button variant="ghost" size="sm" className="ml-auto" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    );
  }
  if (error) {
    return (
      <div className="p-4">
        <Banner tone="bad" icon={<IconAlertCircle aria-hidden />}>
          <span className="font-mono text-mono-12 whitespace-pre-wrap select-text">
            {errorMessage(error)}
          </span>
        </Banner>
      </div>
    );
  }
  if (!result) {
    return (
      <EmptyState
        art={<IconSql className="size-7" aria-hidden />}
        title="Run a query to see results here"
      >
        Press <Kbd>⌘</Kbd> <Kbd>↵</Kbd> to run everything, or select a statement to run just that
        part.
      </EmptyState>
    );
  }
  const columns = asColumns(result);
  const rows = gridRows(columns, result.rows, EMPTY_PENDING, 0);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b-[0.5px] border-line pr-2.5">
        <Message result={result} />
        {columns.length > 0 ? (
          <IconAction
            label="Copy as TSV"
            onClick={() =>
              writeText(asTsv(columns, rows))
                .then(() => toast("Copied the results"))
                .catch((error: unknown) =>
                  toast.error("The results couldn't be copied", {
                    description: errorMessage(error),
                  }),
                )
            }
          >
            <IconCopy />
          </IconAction>
        ) : null}
      </div>
      {columns.length > 0 ? (
        <DataGrid
          label="Query results"
          columns={columns}
          rows={rows}
          offset={0}
          sort={null}
          onSort={undefined}
          selected={new Set()}
          onToggleRow={() => undefined}
          active={active}
          onActive={setActive}
          onEdit={undefined}
          onJump={() => undefined}
          table={undefined}
          onFilter={undefined}
          onDelete={undefined}
        />
      ) : null}
    </div>
  );
}
