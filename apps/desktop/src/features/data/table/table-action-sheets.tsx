import { IconLock } from "@tabler/icons-react";
import { useNavigate } from "@tanstack/react-router";
import { useId, useState } from "react";

import type { ServerInfo, Table } from "@/lib/ipc/bindings";
import { Banner } from "@/ui/banner";
import { Button } from "@/ui/button";
import { Field, Input } from "@/ui/field";
import { Sheet } from "@/ui/sheet";

import { useDropTable, useTruncateTable } from "../api";
import { compactCount, tableKey, tableRef } from "../model";
import { useTableAction } from "../table-action-store";
import { useWorkspace } from "../workspace-store";
import { ImportSheet } from "./import-sheet";

type DangerProps = { info: ServerInfo; table: Table; onClose: () => void };

function SafeModeNote({ className }: { className?: string }) {
  return (
    <Banner tone="warn" icon={<IconLock aria-hidden />} {...(className ? { className } : {})}>
      Safe mode is on for this production database. Allow writes first.
    </Banner>
  );
}

function rowsOf(table: Table): string {
  return table.rowEstimate === null ? "every row" : `all ~${compactCount(table.rowEstimate)} rows`;
}

function TruncateSheet({ info, table, onClose }: DangerProps) {
  const truncate = useTruncateTable(info.id);
  return (
    <Sheet
      open
      onOpenChange={(open) => (open || truncate.isPending ? undefined : onClose())}
      title={`Empty ${table.name}?`}
      description={`Deletes ${rowsOf(table)} of ${tableKey(table)} in ${info.name}. The table and its structure stay. This can't be undone.`}
      footer={
        <>
          <Button disabled={truncate.isPending} onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="danger"
            loading={truncate.isPending}
            disabled={info.readOnly}
            onClick={() => truncate.mutate(tableRef(table), { onSuccess: onClose })}
          >
            Truncate Table
          </Button>
        </>
      }
    >
      {info.readOnly ? <SafeModeNote /> : null}
    </Sheet>
  );
}

/** Dropping asks for the table's name, typed out, so it never happens by a slip. */
function DropSheet({ info, table, onClose }: DangerProps) {
  const id = useId();
  const [typed, setTyped] = useState("");
  const drop = useDropTable(info.id);
  const navigate = useNavigate();
  const closeTab = useWorkspace((state) => state.closeTab);
  const confirmed = typed === table.name;
  const dropped = () => {
    closeTab(info.id, `table:${tableKey(table)}`);
    onClose();
    navigate({ to: "/data/$connection", params: { connection: info.id }, search: {} }).catch(
      () => undefined,
    );
  };
  return (
    <Sheet
      open
      onOpenChange={(open) => (open || drop.isPending ? undefined : onClose())}
      title={`Drop ${table.name}?`}
      description={`Deletes the table ${tableKey(table)} and ${rowsOf(table)} from ${info.name}. This can't be undone.`}
      footer={
        <>
          <Button disabled={drop.isPending} onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="danger"
            type="submit"
            form={id}
            loading={drop.isPending}
            disabled={!confirmed || info.readOnly}
          >
            Drop Table
          </Button>
        </>
      }
    >
      <form
        id={id}
        onSubmit={(event) => {
          event.preventDefault();
          if (confirmed && !info.readOnly) {
            drop.mutate(tableRef(table), { onSuccess: dropped });
          }
        }}
      >
        <Field label={`Type ${table.name} to confirm`} htmlFor={`${id}-name`}>
          <Input
            id={`${id}-name`}
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            className="font-mono text-mono-13"
            autoComplete="off"
            spellCheck={false}
          />
        </Field>
        {info.readOnly ? <SafeModeNote className="mt-3" /> : null}
      </form>
    </Sheet>
  );
}

/** The import, truncate and drop sheets a table's menus open. */
export function TableActionSheets({ info }: { info: ServerInfo }) {
  const action = useTableAction((state) => state.action);
  const close = useTableAction((state) => state.close);
  switch (action?.kind) {
    case "import":
      return (
        <ImportSheet
          key={`${tableKey(action.table)}|${action.path}`}
          info={info}
          table={action.table}
          path={action.path}
          onClose={close}
        />
      );
    case "truncate":
      return (
        <TruncateSheet
          key={tableKey(action.table)}
          info={info}
          table={action.table}
          onClose={close}
        />
      );
    case "drop":
      return (
        <DropSheet key={tableKey(action.table)} info={info} table={action.table} onClose={close} />
      );
    default:
      return null;
  }
}
