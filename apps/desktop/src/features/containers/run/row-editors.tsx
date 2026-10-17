import { IconFolderPlus, IconPlus, IconX } from "@tabler/icons-react";
import { open } from "@tauri-apps/plugin-dialog";
import type { ReactNode } from "react";

import { Button } from "@/ui/button";
import { Checkbox } from "@/ui/checkbox";
import { Input } from "@/ui/field";
import { IconAction } from "@/ui/icon-action";

import { type EnvRow, type PortRow, rowId, type StorageRow } from "./run-model";

type ListProps<Row> = { rows: Row[]; onChange: (rows: Row[]) => void };

const replace = <Row,>(rows: Row[], index: number, row: Row) =>
  rows.map((current, at) => (at === index ? row : current));
const without = <Row,>(rows: Row[], index: number) => rows.filter((_, at) => at !== index);

function Group({
  title,
  actions,
  error,
  children,
}: {
  title: string;
  actions: ReactNode;
  error?: string | undefined;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1">
        <h3 className="m-0 mr-auto text-13 font-semibold text-ink">{title}</h3>
        {actions}
      </div>
      {children}
      {error ? (
        <p role="alert" className="m-0 text-12 text-bad-ink">
          {error}
        </p>
      ) : null}
    </section>
  );
}

const mono = "font-mono text-mono-13";

export function PortsEditor({
  rows,
  onChange,
  error,
  nextPort,
}: ListProps<PortRow> & { error?: string | undefined; nextPort: () => number }) {
  return (
    <Group
      title="Ports"
      error={error}
      actions={
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            onChange([...rows, { id: rowId(), host: String(nextPort()), container: "80" }])
          }
        >
          <IconPlus />
          Add port
        </Button>
      }
    >
      {rows.map((row, index) => (
        <div key={row.id} className="grid grid-cols-[1fr_auto_1fr_auto] items-center gap-2">
          <Input
            aria-label="Mac port"
            inputMode="numeric"
            value={row.host}
            onChange={(event) =>
              onChange(replace(rows, index, { ...row, host: event.target.value }))
            }
            className={mono}
          />
          <span className="text-12 text-ink-3">to</span>
          <Input
            aria-label="Container port"
            inputMode="numeric"
            value={row.container}
            onChange={(event) =>
              onChange(replace(rows, index, { ...row, container: event.target.value }))
            }
            className={mono}
          />
          <IconAction label="Remove port" onClick={() => onChange(without(rows, index))}>
            <IconX />
          </IconAction>
        </div>
      ))}
    </Group>
  );
}

export function EnvEditor({ rows, onChange }: ListProps<EnvRow>) {
  return (
    <Group
      title="Environment"
      actions={
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onChange([...rows, { id: rowId(), key: "", value: "" }])}
        >
          <IconPlus />
          Add variable
        </Button>
      }
    >
      {rows.map((row, index) => (
        <div key={row.id} className="grid grid-cols-[2fr_3fr_auto] items-center gap-2">
          <Input
            aria-label="Variable name"
            placeholder="NAME"
            value={row.key}
            onChange={(event) =>
              onChange(replace(rows, index, { ...row, key: event.target.value }))
            }
            className={mono}
          />
          <Input
            aria-label="Value"
            placeholder="value"
            value={row.value}
            onChange={(event) =>
              onChange(replace(rows, index, { ...row, value: event.target.value }))
            }
            className={mono}
          />
          <IconAction label="Remove variable" onClick={() => onChange(without(rows, index))}>
            <IconX />
          </IconAction>
        </div>
      ))}
    </Group>
  );
}

export function StorageEditor({ rows, onChange }: ListProps<StorageRow>) {
  const addFolder = async () => {
    const folder = await open({ directory: true });
    if (folder) {
      onChange([...rows, { id: rowId(), source: folder, target: "/data", readOnly: false }]);
    }
  };
  return (
    <Group
      title="Storage"
      actions={
        <>
          <Button variant="ghost" size="sm" onClick={() => addFolder().catch(() => undefined)}>
            <IconFolderPlus />
            Folder from Mac
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              onChange([...rows, { id: rowId(), source: "", target: "", readOnly: false }])
            }
          >
            <IconPlus />
            Volume
          </Button>
        </>
      }
    >
      {rows.map((row, index) => (
        <div key={row.id} className="grid grid-cols-[1fr_1fr_auto_auto] items-center gap-2">
          <Input
            aria-label="Volume or Mac folder"
            placeholder="volume name"
            value={row.source}
            onChange={(event) =>
              onChange(replace(rows, index, { ...row, source: event.target.value }))
            }
            className={mono}
          />
          <Input
            aria-label="Path in the container"
            placeholder="/data"
            value={row.target}
            onChange={(event) =>
              onChange(replace(rows, index, { ...row, target: event.target.value }))
            }
            className={mono}
          />
          <span className="flex items-center gap-1.5 text-12 text-ink-3">
            <Checkbox
              checked={row.readOnly}
              onCheckedChange={(readOnly) => onChange(replace(rows, index, { ...row, readOnly }))}
              label="Read only"
            />
            Read only
          </span>
          <IconAction label="Remove storage" onClick={() => onChange(without(rows, index))}>
            <IconX />
          </IconAction>
        </div>
      ))}
    </Group>
  );
}
