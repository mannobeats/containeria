import { IconAlertCircle, IconCircleCheck, IconPlugConnected } from "@tabler/icons-react";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import type { Connection } from "@/lib/ipc/bindings";
import { errorMessage } from "@/lib/ipc/errors";
import { Banner } from "@/ui/banner";
import { Button } from "@/ui/button";
import { Sheet } from "@/ui/sheet";
import { Tile } from "@/ui/tile";

import { useSaveConnection, useTestConnection } from "./api";
import { ConnectionFields } from "./connection-fields";
import { type ConnectionForm, formFromConnection, formProblem, toInput } from "./connection-form";
import { EnginePicker } from "./engine-picker";
import { ENGINE_CHOICES, engineLabel, engineLogo } from "./engines";

type ConnectionSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Edits this connection; without it the sheet creates one. */
  connection?: Connection | undefined;
};

function Chosen({ form, onChange }: { form: ConnectionForm; onChange?: (() => void) | undefined }) {
  const choice = ENGINE_CHOICES.find(
    (candidate) =>
      candidate.engine === form.engine && (candidate.provider ?? null) === form.provider,
  );
  return (
    <div className="mb-4 flex items-center gap-3 rounded-lg bg-fill px-3 py-2.5">
      <Tile logo={engineLogo(form.engine, form.provider)} icon="data" size="lg" />
      <div className="min-w-0 flex-1">
        <b className="font-semibold text-ink">{choice?.label ?? engineLabel(form.engine)}</b>
        <p className="m-0 text-12 text-ink-3">{choice?.hint}</p>
      </div>
      {onChange ? (
        <Button variant="ghost" size="sm" onClick={onChange}>
          Change engine
        </Button>
      ) : null}
    </div>
  );
}

function Outcome({ version, error }: { version: string | undefined; error: unknown }) {
  if (error) {
    return (
      <Banner tone="bad" icon={<IconAlertCircle aria-hidden />} className="mt-4">
        <b>Couldn't connect.</b> {errorMessage(error)}
      </Banner>
    );
  }
  return version ? (
    <Banner tone="ok" icon={<IconCircleCheck aria-hidden />} className="mt-4">
      <b>Connected.</b> {version}
    </Banner>
  ) : null;
}

/** Creates or edits a saved connection. The password goes to the Keychain. */
export function ConnectionSheet({ open, onOpenChange, connection }: ConnectionSheetProps) {
  const navigate = useNavigate();
  const [form, setForm] = useState<ConnectionForm | null>(
    connection ? formFromConnection(connection) : null,
  );
  const [problem, setProblem] = useState<string | null>(null);
  const test = useTestConnection();
  const save = useSaveConnection();
  const close = () => {
    onOpenChange(false);
    setForm(connection ? formFromConnection(connection) : null);
    test.reset();
  };
  const submit = (then: "test" | "save") => {
    if (!form) {
      return;
    }
    const issue = formProblem(form);
    setProblem(issue);
    if (issue) {
      return;
    }
    if (then === "test") {
      test.mutate(toInput(form));
      return;
    }
    save.mutate(toInput(form), {
      onSuccess: (saved) => {
        close();
        navigate({ to: "/data/$connection", params: { connection: saved.id } }).catch(
          () => undefined,
        );
      },
    });
  };
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
      title={connection ? `Edit ${connection.name}` : "New connection"}
      width="lg"
      footer={
        <>
          <Button
            disabled={!form}
            loading={test.isPending}
            onClick={() => submit("test")}
            className="mr-auto"
          >
            <IconPlugConnected />
            Test connection
          </Button>
          <Button onClick={close}>Cancel</Button>
          <Button
            variant="brand"
            disabled={!form}
            loading={save.isPending}
            onClick={() => submit("save")}
          >
            {connection ? "Save" : "Save and connect"}
          </Button>
        </>
      }
    >
      {form ? (
        <>
          <Chosen form={form} onChange={connection ? undefined : () => setForm(null)} />
          <ConnectionFields
            form={form}
            onChange={(change) => setForm({ ...form, ...change })}
            problem={problem}
          />
          <Outcome version={test.data} error={test.error} />
        </>
      ) : (
        <EnginePicker onPick={setForm} />
      )}
    </Sheet>
  );
}
