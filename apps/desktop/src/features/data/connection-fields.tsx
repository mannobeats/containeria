import { IconEye, IconEyeOff, IconLock } from "@tabler/icons-react";
import { open } from "@tauri-apps/plugin-dialog";
import { useId, useState } from "react";

import type { Environment } from "@/lib/ipc/bindings";
import { Button } from "@/ui/button";
import { Field, Input } from "@/ui/field";
import { Segmented } from "@/ui/segmented";
import { Switch } from "@/ui/switch";

import type { ConnectionForm } from "./connection-form";

type FieldsProps = {
  form: ConnectionForm;
  onChange: (change: Partial<ConnectionForm>) => void;
  problem: string | null;
};

const ENVIRONMENT_HINT: Record<Environment, string> = {
  local: "No restrictions.",
  staging: "Shown with an amber label so it's never mistaken for local.",
  production: "Opens read-only. You can allow writes for 15 minutes at a time.",
};

const mono = "font-mono text-mono-13";

function PasswordField({ form, onChange }: Omit<FieldsProps, "problem">) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  return (
    <Field
      label="Password"
      htmlFor={id}
      hint={form.passwordChanged ? undefined : "Saved in your Keychain. Type to replace it."}
    >
      <div className="flex gap-1.5">
        <Input
          id={id}
          className={mono}
          type={visible ? "text" : "password"}
          value={form.password}
          placeholder={form.passwordChanged ? "Stored in Keychain" : "••••••••"}
          onChange={(event) => onChange({ password: event.target.value, passwordChanged: true })}
        />
        <Button
          iconOnly
          aria-label={visible ? "Hide password" : "Show password"}
          onClick={() => setVisible(!visible)}
        >
          {visible ? <IconEyeOff /> : <IconEye />}
        </Button>
      </div>
    </Field>
  );
}

function SqliteFile({ form, onChange }: Omit<FieldsProps, "problem">) {
  const id = useId();
  const choose = () =>
    open({
      multiple: false,
      filters: [{ name: "SQLite database", extensions: ["sqlite", "sqlite3", "db", "db3"] }],
    })
      .then((file) => (typeof file === "string" ? onChange({ file }) : undefined))
      .catch(() => undefined);
  return (
    <Field label="File" htmlFor={id}>
      <div className="flex gap-1.5">
        <Input
          id={id}
          className={mono}
          value={form.file}
          placeholder="~/Projects/app/dev.sqlite"
          onChange={(event) => onChange({ file: event.target.value })}
        />
        <Button onClick={choose}>Choose…</Button>
      </div>
    </Field>
  );
}

function ServerFields({ form, onChange }: Omit<FieldsProps, "problem">) {
  const ids = { host: useId(), port: useId(), user: useId(), database: useId() };
  const text = (key: "host" | "port" | "user" | "database") => ({
    id: ids[key],
    className: mono,
    value: form[key],
    spellCheck: false,
    onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
      onChange({ [key]: event.target.value }),
  });
  return (
    <>
      <Field label="Host" htmlFor={ids.host}>
        <Input {...text("host")} placeholder="localhost" />
      </Field>
      <Field label="Port" htmlFor={ids.port}>
        <Input {...text("port")} inputMode="numeric" />
      </Field>
      <Field label="User" htmlFor={ids.user}>
        <Input {...text("user")} />
      </Field>
      <PasswordField form={form} onChange={onChange} />
      <div className="col-span-2">
        <Field label="Database" htmlFor={ids.database}>
          <Input {...text("database")} placeholder={form.engine === "redis" ? "0" : "Default"} />
        </Field>
      </div>
      <div className="col-span-2 flex items-center gap-2 text-13 text-ink">
        <Switch
          checked={form.tls}
          onCheckedChange={(tls) => onChange({ tls })}
          label="Require TLS"
        />
        <span aria-hidden>Require TLS</span>
      </div>
    </>
  );
}

/** The fields for one engine, plus the environment that decides safe mode. */
export function ConnectionFields({ form, onChange, problem }: FieldsProps) {
  const name = useId();
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-x-3.5 gap-y-3">
        <div className="col-span-2">
          <Field label="Name" htmlFor={name}>
            <Input
              id={name}
              value={form.name}
              placeholder="billing-staging"
              onChange={(event) => onChange({ name: event.target.value })}
            />
          </Field>
        </div>
        {form.engine === "sqlite" ? (
          <div className="col-span-2">
            <SqliteFile form={form} onChange={onChange} />
          </div>
        ) : (
          <ServerFields form={form} onChange={onChange} />
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-13 font-medium text-ink-2">Environment</span>
        <div className="flex items-center gap-3">
          <Segmented
            label="Environment"
            value={form.environment}
            onChange={(environment) => onChange({ environment })}
            options={[
              { value: "local", label: "Local" },
              { value: "staging", label: "Staging" },
              { value: "production", label: "Production" },
            ]}
          />
          <span className="inline-flex items-center gap-1 text-12 text-ink-3">
            {form.environment === "production" ? (
              <IconLock className="size-3.5" aria-hidden />
            ) : null}
            {ENVIRONMENT_HINT[form.environment]}
          </span>
        </div>
      </div>
      {problem ? (
        <p role="alert" className="m-0 text-12 text-bad-ink">
          {problem}
        </p>
      ) : null}
    </div>
  );
}
