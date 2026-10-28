import clsx from "clsx";
import { type FormEvent, useId, useState } from "react";

import { useContainers } from "@/features/containers/api";
import type { CustomRoute } from "@/lib/ipc/bindings";
import { Button } from "@/ui/button";
import { Field, Input } from "@/ui/field";
import { inputClass } from "@/ui/input-class";
import { Sheet } from "@/ui/sheet";
import { Switch } from "@/ui/switch";

import { isValidHost } from "./model";

type RouteSheetProps = {
  /** The route being edited, or `null` to add one. */
  editing: CustomRoute | null;
  onClose: () => void;
  onSave: (route: CustomRoute) => void;
};

type Draft = { host: string; container: string; port: string; https: boolean };

function draftOf(route: CustomRoute | null, firstContainer: string): Draft {
  return route
    ? { host: route.host, container: route.container, port: String(route.port), https: route.https }
    : { host: "", container: firstContainer, port: "3000", https: true };
}

function problems(draft: Draft): { host?: string; port?: string } {
  const port = Number(draft.port);
  return {
    ...(isValidHost(draft.host) ? {} : { host: "Use a name like shop.test" }),
    ...(Number.isInteger(port) && port > 0 && port < 65_536
      ? {}
      : { port: "Use a port from 1 to 65535" }),
  };
}

/** Add or edit a route: any name, pointing at one port of a container. */
export function RouteSheet({ editing, onClose, onSave }: RouteSheetProps) {
  const id = useId();
  const { data: containers } = useContainers();
  const [draft, setDraft] = useState(() => draftOf(editing, ""));
  const listed = (containers ?? [])
    .filter((container) => container.pod === null)
    .map((container) => container.name);
  // A route can outlive its container; keep that name pickable so what's shown is what's saved.
  const names =
    draft.container && !listed.includes(draft.container) ? [draft.container, ...listed] : listed;
  // Containers may arrive after the sheet opens; until one is picked, the first is the choice.
  const container = draft.container || names[0] || "";
  const [tried, setTried] = useState(false);
  const errors = tried ? problems(draft) : {};
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTried(true);
    if (Object.keys(problems(draft)).length === 0) {
      onSave({
        host: draft.host.trim().toLowerCase(),
        container,
        port: Number(draft.port),
        https: draft.https,
      });
    }
  };
  return (
    <Sheet
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={editing ? "Edit route" : "Add route"}
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field
          label="Domain"
          htmlFor={`${id}-host`}
          error={errors.host}
          hint="Any name works: .test, .local or your own. Containeria answers for it on this Mac only."
        >
          <Input
            id={`${id}-host`}
            className="font-mono"
            placeholder="shop.test"
            value={draft.host}
            aria-invalid={errors.host ? true : undefined}
            onChange={(event) => setDraft({ ...draft, host: event.target.value })}
          />
        </Field>
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <Field label="Points to" htmlFor={`${id}-container`}>
              <select
                id={`${id}-container`}
                className={clsx(inputClass, "appearance-auto")}
                value={container}
                onChange={(event) => setDraft({ ...draft, container: event.target.value })}
              >
                {names.map((name) => (
                  <option key={name}>{name}</option>
                ))}
              </select>
            </Field>
          </div>
          <div className="w-[110px]">
            <Field label="Port" htmlFor={`${id}-port`} error={errors.port}>
              <Input
                id={`${id}-port`}
                className="font-mono tabular"
                inputMode="numeric"
                value={draft.port}
                aria-invalid={errors.port ? true : undefined}
                onChange={(event) => setDraft({ ...draft, port: event.target.value })}
              />
            </Field>
          </div>
        </div>
        <span className="flex items-center gap-2 text-13 text-ink">
          <Switch
            checked={draft.https}
            onCheckedChange={(https) => setDraft({ ...draft, https })}
            label="Serve over HTTPS"
          />
          Serve over HTTPS
        </span>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="brand" disabled={names.length === 0}>
            {editing ? "Save route" : "Add route"}
          </Button>
        </div>
      </form>
    </Sheet>
  );
}
