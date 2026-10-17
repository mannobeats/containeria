import { IconBookmark, IconHistory, IconPlayerPlay } from "@tabler/icons-react";
import { useId, useState } from "react";

import type { Namespace, ServerInfo } from "@/lib/ipc/bindings";
import { Button } from "@/ui/button";
import { CodeEditor } from "@/ui/code-editor";
import { Field, Input } from "@/ui/field";
import { IconAction } from "@/ui/icon-action";
import { Kbd } from "@/ui/kbd";
import { Sheet } from "@/ui/sheet";

import { useCancelQuery, useRunQuery, useSaveQuery } from "../api";
import { useOpenTab } from "../tabs";
import { useWorkspace } from "../workspace-store";
import { QueryResults } from "./query-results";
import { sqlLanguage } from "./sql-language";

type QueryViewProps = { info: ServerInfo; tabKey: string; namespaces: Namespace[] };

function SaveSheet({
  open,
  onClose,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (name: string) => void;
}) {
  const id = useId();
  const [name, setName] = useState("");
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => (next ? undefined : onClose())}
      title="Save query"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="brand" disabled={name.trim() === ""} onClick={() => onSave(name.trim())}>
            Save
          </Button>
        </>
      }
    >
      <Field label="Name" htmlFor={id}>
        <Input
          id={id}
          value={name}
          placeholder="Stuck pending orders"
          onChange={(event) => setName(event.target.value)}
        />
      </Field>
    </Sheet>
  );
}

/** The SQL editor of one query tab: write, run with ⌘↵, read the results below. */
export function QueryView({ info, tabKey, namespaces }: QueryViewProps) {
  const sqlKey = `${info.id}|${tabKey}`;
  const sql = useWorkspace((state) => state.sql[sqlKey]) ?? "";
  const setSql = useWorkspace((state) => state.setSql);
  const run = useRunQuery(info.id);
  const save = useSaveQuery();
  const open = useOpenTab(info.id);
  const [saving, setSaving] = useState(false);
  const cancel = useCancelQuery();
  const language = sqlLanguage(info.engine, namespaces);
  const execute = (code: string) => {
    if (code.trim() === "" || run.isPending) {
      return;
    }
    run.mutate({ sql: code, runId: crypto.randomUUID() });
  };
  return (
    <div className="grid min-h-0 flex-1 grid-rows-[44px_minmax(120px,42%)_minmax(0,1fr)]">
      <div className="flex items-center gap-2 border-b-[0.5px] border-line px-3">
        <Button variant="brand" size="sm" loading={run.isPending} onClick={() => execute(sql)}>
          <IconPlayerPlay />
          Run
          <Kbd className="bg-white/15 text-white shadow-none">⌘↵</Kbd>
        </Button>
        <span aria-hidden className="mx-1 h-4 w-[0.5px] bg-line" />
        <IconAction label="Save query" onClick={() => setSaving(true)}>
          <IconBookmark />
        </IconAction>
        <IconAction
          label="Query history"
          onClick={() => open({ key: "history", kind: "history", title: "History" })}
        >
          <IconHistory />
        </IconAction>
        {info.readOnly ? (
          <span className="ml-auto text-12 text-ink-3">
            Runs read-only: the database refuses writes in safe mode.
          </span>
        ) : null}
      </div>
      <CodeEditor
        value={sql}
        onChange={(next) => setSql(sqlKey, next)}
        onRun={execute}
        extensions={language}
        label="SQL"
        className="border-b-[0.5px] border-line"
      />
      <div className="flex min-h-0 flex-col">
        <QueryResults
          result={run.data}
          error={run.error}
          running={run.isPending}
          onCancel={() => run.variables && cancel.mutate(run.variables.runId)}
        />
      </div>
      <SaveSheet
        key={String(saving)}
        open={saving}
        onClose={() => setSaving(false)}
        onSave={(name) => {
          save.mutate({ id: "", name, connectionId: info.id, sql });
          setSaving(false);
        }}
      />
    </div>
  );
}
