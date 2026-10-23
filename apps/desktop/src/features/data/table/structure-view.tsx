import { IconCheck, IconKey, IconLink } from "@tabler/icons-react";
import type { ReactNode } from "react";

import { formatBytes } from "@/lib/format";
import type { Table } from "@/lib/ipc/bindings";
import { Chip } from "@/ui/chip";
import { Dash } from "@/ui/dash";

const tableClass =
  "w-full border-separate border-spacing-0 text-13 [&_td]:h-[34px] [&_td]:border-b-[0.5px] [&_td]:border-line [&_td]:px-2.5 [&_td:first-child]:pl-5 [&_th]:h-[30px] [&_th]:border-b-[0.5px] [&_th]:border-line [&_th]:px-2.5 [&_th]:text-left [&_th]:text-12 [&_th]:font-medium [&_th]:text-ink-3 [&_th:first-child]:pl-5";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-6">
      <h3 className="m-0 px-5 pt-2.5 pb-2 text-13 font-semibold text-ink">{title}</h3>
      {children}
    </section>
  );
}

/** Columns, keys and indexes of one table, as the database reports them. */
export function StructureView({ table }: { table: Table }) {
  const references = table.columns.filter((column) => column.references);
  return (
    <div className="min-h-0 flex-1 overflow-auto pt-2 pb-10">
      <p className="m-0 px-5 pb-2 text-12 text-ink-3">
        {table.rowEstimate === null
          ? null
          : `~${table.rowEstimate.toLocaleString("en-US")} rows · `}
        {table.sizeBytes === null ? null : `${formatBytes(table.sizeBytes)} on disk · `}
        {table.indexes.length} {table.indexes.length === 1 ? "index" : "indexes"}
      </p>
      <Section title="Columns">
        <table className={tableClass}>
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Nullable</th>
              <th>Default</th>
              <th>Key</th>
            </tr>
          </thead>
          <tbody>
            {table.columns.map((column) => (
              <tr key={column.name}>
                <td className="font-mono text-mono-13 text-ink">{column.name}</td>
                <td className="font-mono text-mono-13 text-brand-ink">{column.typeName}</td>
                <td className={column.nullable ? "text-12 text-ink-3" : "text-ink-3"}>
                  {column.nullable ? "nullable" : "not null"}
                </td>
                <td className="max-w-64 truncate font-mono text-mono-12 text-ink-3">
                  {column.default ?? <Dash />}
                </td>
                <td>
                  {column.primaryKey ? (
                    <Chip>
                      <IconKey aria-hidden />
                      Primary
                    </Chip>
                  ) : null}
                  {column.references ? (
                    <Chip>
                      <IconLink aria-hidden />
                      {column.references.table}.{column.references.column}
                    </Chip>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
      {table.indexes.length > 0 ? (
        <Section title="Indexes">
          <table className={tableClass}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Columns</th>
                <th>Unique</th>
              </tr>
            </thead>
            <tbody>
              {table.indexes.map((index) => (
                <tr key={index.name}>
                  <td className="font-mono text-mono-13 text-ink">{index.name}</td>
                  <td className="font-mono text-mono-12">{index.columns.join(", ")}</td>
                  <td>
                    {index.unique ? (
                      <IconCheck className="text-ok-ink" aria-label="Unique" />
                    ) : (
                      <Dash />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      ) : null}
      {references.length > 0 ? (
        <Section title="Foreign keys">
          <table className={tableClass}>
            <thead>
              <tr>
                <th>Column</th>
                <th>References</th>
              </tr>
            </thead>
            <tbody>
              {references.map((column) => (
                <tr key={column.name}>
                  <td className="font-mono text-mono-13">{column.name}</td>
                  <td className="font-mono text-mono-13">
                    {column.references?.schema ? `${column.references.schema}.` : ""}
                    {column.references?.table}.{column.references?.column}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      ) : null}
    </div>
  );
}
