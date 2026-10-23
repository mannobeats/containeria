import { IconAlertCircle, IconLock } from "@tabler/icons-react";
import clsx from "clsx";
import { useState } from "react";

import type {
  Delimiter,
  ImportedRows,
  ImportOptions,
  ImportPreview,
  ServerInfo,
  Table,
} from "@/lib/ipc/bindings";
import { errorMessage } from "@/lib/ipc/errors";
import { Banner } from "@/ui/banner";
import { Button } from "@/ui/button";
import { Checkbox } from "@/ui/checkbox";
import { Progress } from "@/ui/progress";
import { Select } from "@/ui/select";
import { Sheet } from "@/ui/sheet";

import { useImport, useImportPreview } from "../api";
import { tableRef } from "../model";
import {
  autoMatch,
  fileName,
  importedShare,
  importFormat,
  type Matches,
  sampleRows,
  toMapping,
  withMatch,
} from "./import-model";

const DELIMITER_NAMES: Record<Delimiter, string> = {
  auto: "Detect",
  comma: "Comma",
  semicolon: "Semicolon",
  tab: "Tab",
};

const SAMPLE_ROWS = 5;

const cellClass =
  "max-w-[180px] truncate border-b-[0.5px] border-line px-2 py-1.5 text-left font-mono text-mono-12";

function delimiterOptions(detected: Delimiter | undefined) {
  return (Object.keys(DELIMITER_NAMES) as Delimiter[]).map((value) => ({
    value,
    label:
      value === "auto" && detected && detected !== "auto"
        ? `Detect (${DELIMITER_NAMES[detected]})`
        : DELIMITER_NAMES[value],
  }));
}

type MappingProps = {
  preview: ImportPreview;
  table: Table;
  matches: Matches;
  onMatch: (source: string, column: string) => void;
};

/** Each file column, an example value, and the table column it goes into. */
function MappingTable({ preview, table, matches, onMatch }: MappingProps) {
  const options = [
    { value: "", label: "Skip" },
    ...table.columns.map((column) => ({ value: column.name, label: column.name })),
  ];
  return (
    <table
      aria-label="Columns"
      className="w-full table-fixed border-separate border-spacing-0 text-13"
    >
      <thead>
        <tr className="text-12 text-ink-3 [&>th]:border-b-[0.5px] [&>th]:border-line [&>th]:px-2 [&>th]:pb-1.5 [&>th]:text-left [&>th]:font-medium">
          <th>File column</th>
          <th>Example</th>
          <th className="w-[190px]">Into column</th>
          <th className="w-[130px]">Type</th>
        </tr>
      </thead>
      <tbody>
        {preview.columns.map((source, index) => {
          const target = table.columns.find((column) => column.name === matches[source]);
          const example = preview.rows[0]?.[index];
          return (
            <tr
              key={source}
              className="[&>td]:border-b-[0.5px] [&>td]:border-line [&>td]:px-2 [&>td]:py-1"
            >
              <td className="truncate font-medium text-ink">{source}</td>
              <td className="truncate font-mono text-mono-12 text-ink-3">{example ?? "NULL"}</td>
              <td>
                <Select
                  label={`Column for ${source}`}
                  value={matches[source] ?? ""}
                  options={options}
                  onChange={(column) => onMatch(source, column)}
                />
              </td>
              <td className="truncate font-mono text-mono-12 text-ink-3">
                {target?.typeName ?? "skipped"}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** The file's first rows as they were read. */
function FirstRows({ preview }: { preview: ImportPreview }) {
  return (
    <div className="overflow-auto rounded-md hairline">
      <table aria-label="First rows of the file" className="border-separate border-spacing-0">
        <thead>
          <tr>
            {preview.columns.map((column) => (
              <th
                key={column}
                className={clsx(cellClass, "bg-fill font-sans text-12 font-medium text-ink-3")}
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sampleRows(preview.rows, SAMPLE_ROWS).map(({ key, values }) => (
            <tr key={key}>
              {preview.columns.map((column, index) => (
                <td
                  key={column}
                  className={clsx(cellClass, values[index] == null ? "text-ink-3" : "text-ink")}
                >
                  {values[index] ?? "NULL"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type OptionsBarProps = {
  options: ImportOptions;
  detected: Delimiter | undefined;
  onOptions: (change: Partial<ImportOptions>) => void;
  emptyFirst: boolean;
  onEmptyFirst: (emptyFirst: boolean) => void;
};

function OptionsBar({ options, detected, onOptions, emptyFirst, onEmptyFirst }: OptionsBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-13 text-ink">
      {options.format === "csv" ? (
        <>
          <span className="flex items-center gap-2">
            <Checkbox
              checked={options.header}
              onCheckedChange={(header) => onOptions({ header })}
              label="First row is the header"
            />
            First row is the header
          </span>
          <span className="flex items-center gap-2">
            Delimiter
            <Select
              label="Delimiter"
              value={options.delimiter}
              options={delimiterOptions(detected)}
              onChange={(delimiter) => onOptions({ delimiter })}
              className="w-[170px]"
            />
          </span>
        </>
      ) : null}
      <span className="flex items-center gap-2">
        <Checkbox
          checked={emptyFirst}
          onCheckedChange={onEmptyFirst}
          label="Empty the table first"
        />
        Empty the table first
      </span>
    </div>
  );
}

/** The matching table and the first rows, or why there's nothing to match. */
function FileColumns(props: MappingProps) {
  if (props.preview.columns.length === 0) {
    return <Banner icon={<IconAlertCircle aria-hidden />}>The file has no rows to import.</Banner>;
  }
  return (
    <>
      <MappingTable {...props} />
      <FirstRows preview={props.preview} />
    </>
  );
}

function Imported({ progress }: { progress: ImportedRows | null }) {
  return (
    <div className="flex flex-col gap-1.5" aria-live="polite">
      <Progress label="Import progress" {...(progress ? { value: importedShare(progress) } : {})} />
      <span className="text-12 text-ink-3 tabular">
        {(progress?.rows ?? 0).toLocaleString("en-US")} rows imported
      </span>
    </div>
  );
}

type ImportSheetProps = { info: ServerInfo; table: Table; path: string; onClose: () => void };

/** Imports a CSV or JSON file into a table: options, column matching, then progress. */
export function ImportSheet({ info, table, path, onClose }: ImportSheetProps) {
  const [options, setOptions] = useState<ImportOptions>({
    format: importFormat(path),
    header: true,
    delimiter: "auto",
  });
  const [emptyFirst, setEmptyFirst] = useState(false);
  const [edited, setEdited] = useState<Matches | null>(null);
  const [progress, setProgress] = useState<ImportedRows | null>(null);
  const preview = useImportPreview(path, options);
  const importer = useImport(info.id);
  const sources = preview.data?.columns ?? [];
  const matches = edited ?? autoMatch(sources, table.columns);
  const mapping = toMapping(sources, matches);
  const change = (next: Partial<ImportOptions>) => {
    setEdited(null);
    setOptions({ ...options, ...next });
  };
  const start = () => {
    setProgress(null);
    importer.mutate(
      {
        request: { table: tableRef(table), path, options, mapping, emptyFirst },
        onProgress: setProgress,
      },
      { onSuccess: onClose },
    );
  };
  return (
    <Sheet
      open
      onOpenChange={(open) => (open || importer.isPending ? undefined : onClose())}
      width="lg"
      title={`Import into ${table.name}`}
      description={fileName(path)}
      footer={
        <>
          <Button disabled={importer.isPending} onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="brand"
            loading={importer.isPending}
            disabled={mapping.length === 0 || info.readOnly || !preview.data}
            onClick={start}
          >
            Import
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3.5">
        <OptionsBar
          options={options}
          detected={preview.data?.delimiter}
          onOptions={change}
          emptyFirst={emptyFirst}
          onEmptyFirst={setEmptyFirst}
        />
        {info.readOnly ? (
          <Banner tone="warn" icon={<IconLock aria-hidden />}>
            Safe mode is on for this production database. Allow writes to import.
          </Banner>
        ) : null}
        {preview.isError ? (
          <Banner tone="bad" icon={<IconAlertCircle aria-hidden />}>
            <b>The file couldn't be read.</b> {errorMessage(preview.error)}
          </Banner>
        ) : null}
        {preview.data ? (
          <FileColumns
            preview={preview.data}
            table={table}
            matches={matches}
            onMatch={(source, column) => setEdited(withMatch(matches, source, column))}
          />
        ) : null}
        {importer.isPending ? <Imported progress={progress} /> : null}
        {importer.isError ? (
          <Banner tone="bad" icon={<IconAlertCircle aria-hidden />}>
            <b>Nothing was imported.</b> {errorMessage(importer.error)}
          </Banner>
        ) : null}
      </div>
    </Sheet>
  );
}
