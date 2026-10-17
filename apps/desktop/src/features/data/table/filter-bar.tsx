import {
  IconDots,
  IconFilterPlus,
  IconLayoutSidebarRight,
  IconRefresh,
  IconTableExport,
  IconX,
} from "@tabler/icons-react";
import { save } from "@tauri-apps/plugin-dialog";

import type { Column, ExportFormat, Filter, ServerInfo, Table } from "@/lib/ipc/bindings";
import { Button } from "@/ui/button";
import { IconAction } from "@/ui/icon-action";
import { Menu } from "@/ui/menu";
import { Segmented } from "@/ui/segmented";

import { useExport, useRefreshSchema } from "../api";
import { opLabel, tableRef, whereText } from "../model";
import { useTableActions } from "../use-table-actions";
import type { GridView } from "../workspace-store";
import { FilterPopover } from "./filter-popover";

type FilterBarProps = {
  info: ServerInfo;
  table: Table;
  view: GridView;
  onView: (change: Partial<GridView>) => void;
};

function FilterChip({
  columns,
  filter,
  onChange,
  onRemove,
}: {
  columns: Column[];
  filter: Filter;
  onChange: (filter: Filter) => void;
  onRemove: () => void;
}) {
  return (
    <span className="inline-flex h-6 shrink-0 items-stretch overflow-hidden rounded-sm bg-fill hairline">
      <FilterPopover columns={columns} filter={filter} onApply={onChange}>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 pr-1 pl-2 text-12 hover:bg-hover"
        >
          <span className="font-mono text-mono-12 text-ink">{filter.column}</span>
          <span className="text-ink-3">{opLabel(filter.op)}</span>
          {filter.value === null ? null : (
            <span className="font-mono text-mono-12 text-brand-ink">{filter.value}</span>
          )}
        </button>
      </FilterPopover>
      <button
        type="button"
        aria-label={`Remove the filter on ${filter.column}`}
        onClick={onRemove}
        className="grid w-[22px] place-items-center text-ink-3 hover:bg-press hover:text-ink [&_.tabler-icon]:size-3"
      >
        <IconX />
      </button>
    </span>
  );
}

const FORMATS: { format: ExportFormat; label: string; extension: string }[] = [
  { format: "csv", label: "CSV", extension: "csv" },
  { format: "json", label: "JSON", extension: "json" },
  { format: "sql", label: "SQL inserts", extension: "sql" },
];

/** Data or structure, the filters as chips, and the table's tools. */
export function FilterBar({ info, table, view, onView }: FilterBarProps) {
  const exporter = useExport(info.id);
  const refresh = useRefreshSchema(info.id);
  const actions = useTableActions(info);
  const destroy = actions.destroy(table);
  const more = [
    ...actions.imports(table),
    ...(destroy.length > 0 ? [{ kind: "separator" as const }, ...destroy] : []),
  ];
  const setFilters = (filters: Filter[]) => onView({ filters, page: 0 });
  const exportAs = (format: ExportFormat, extension: string) =>
    save({ defaultPath: `${table.name}.${extension}` })
      .then((path) =>
        path
          ? exporter.mutate({
              request: {
                table: tableRef(table),
                filters: view.filters,
                sort: view.sort,
                limit: 1000,
                offset: 0,
              },
              format,
              path,
            })
          : undefined,
      )
      .catch(() => undefined);
  return (
    <div className="flex h-11 min-w-0 shrink-0 items-center gap-2 border-b-[0.5px] border-line px-3">
      <Segmented
        size="sm"
        label="Show"
        value={view.structure ? "structure" : "data"}
        onChange={(value) => onView({ structure: value === "structure" })}
        options={[
          { value: "data", label: "Data" },
          { value: "structure", label: "Structure" },
        ]}
      />
      <span aria-hidden className="mx-1 h-4 w-[0.5px] bg-line" />
      <div className="flex min-w-0 items-center gap-1.5 overflow-hidden">
        {view.filters.map((filter, index) => (
          <FilterChip
            key={`${filter.column}-${filter.op}-${filter.value ?? ""}`}
            columns={table.columns}
            filter={filter}
            onChange={(changed) =>
              setFilters(view.filters.map((old, position) => (position === index ? changed : old)))
            }
            onRemove={() => setFilters(view.filters.filter((_, position) => position !== index))}
          />
        ))}
        <FilterPopover
          columns={table.columns}
          onApply={(filter) => setFilters([...view.filters, filter])}
        >
          <Button variant="ghost" size="sm">
            <IconFilterPlus />
            {view.filters.length > 0 ? null : "Filter"}
          </Button>
        </FilterPopover>
        {view.filters.length > 0 ? (
          <Button variant="ghost" size="sm" onClick={() => setFilters([])}>
            Clear
          </Button>
        ) : null}
      </div>
      <div className="ml-auto flex items-center gap-1">
        {view.filters.length > 0 ? (
          <code className="max-w-[280px] truncate rounded-[5px] bg-fill px-[7px] py-[3px] font-mono text-mono-12 text-ink-3">
            where {whereText(view.filters)}
          </code>
        ) : null}
        <IconAction label="Refresh" onClick={() => refresh.mutate()}>
          <IconRefresh />
        </IconAction>
        <Menu
          entries={FORMATS.map(({ format, label, extension }) => ({
            label: `Export as ${label}…`,
            onSelect: () => exportAs(format, extension),
          }))}
          align="end"
        >
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            aria-label="Export rows"
            className="text-ink-3 hover:text-ink"
          >
            <IconTableExport />
          </Button>
        </Menu>
        {more.length > 0 ? (
          <Menu entries={more} align="end">
            <Button
              variant="ghost"
              size="sm"
              iconOnly
              aria-label="More table actions"
              className="text-ink-3 hover:text-ink"
            >
              <IconDots />
            </Button>
          </Menu>
        ) : null}
        <IconAction
          label={view.inspector ? "Hide row inspector" : "Row inspector"}
          onClick={() => onView({ inspector: !view.inspector })}
        >
          <IconLayoutSidebarRight />
        </IconAction>
      </div>
    </div>
  );
}
