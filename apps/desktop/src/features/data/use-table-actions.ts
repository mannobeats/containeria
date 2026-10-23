import { open, save } from "@tauri-apps/plugin-dialog";

import type { ServerInfo, Table } from "@/lib/ipc/bindings";
import type { MenuEntry } from "@/ui/menu";

import { useExport } from "./api";
import { tableRef } from "./model";
import { exportFormat } from "./table/import-model";
import { useTableAction } from "./table-action-store";

const IMPORTABLE = [
  { name: "CSV or JSON", extensions: ["csv", "tsv", "txt", "json", "ndjson", "jsonl"] },
];
const EXPORTABLE = [
  { name: "CSV", extensions: ["csv"] },
  { name: "JSON", extensions: ["json"] },
  { name: "SQL inserts", extensions: ["sql"] },
];

/** What a table's menus can do to it: import and export, then empty and drop it, last. */
export function useTableActions(info: ServerInfo) {
  const show = useTableAction((state) => state.show);
  const exporter = useExport(info.id);
  const writable = info.capabilities.editRows;
  const importInto = (table: Table) =>
    open({ multiple: false, directory: false, filters: IMPORTABLE })
      .then((path) => (path ? show({ kind: "import", table, path }) : undefined))
      .catch(() => undefined);
  const exportAll = (table: Table) =>
    save({ defaultPath: `${table.name}.csv`, filters: EXPORTABLE })
      .then((path) =>
        path
          ? exporter.mutate({
              request: { table: tableRef(table), filters: [], sort: null, limit: 1000, offset: 0 },
              format: exportFormat(path),
              path,
            })
          : undefined,
      )
      .catch(() => undefined);
  return {
    /** Import Data…, where rows can be written. */
    imports: (table: Table): MenuEntry[] =>
      writable && table.kind === "table"
        ? [{ label: "Import Data…", onSelect: () => importInto(table) }]
        : [],
    /** Export… of every row, in the format the file name picks. */
    exports: (table: Table): MenuEntry[] => [
      { label: "Export…", onSelect: () => exportAll(table) },
    ],
    /** Truncate Table… and Drop Table…, both asking first. Empty for views and engines without SQL edits. */
    destroy: (table: Table): MenuEntry[] =>
      writable && table.kind === "table"
        ? [
            {
              label: "Truncate Table…",
              danger: true,
              onSelect: () => show({ kind: "truncate", table }),
            },
            {
              label: "Drop Table…",
              danger: true,
              onSelect: () => show({ kind: "drop", table }),
            },
          ]
        : [],
  };
}
