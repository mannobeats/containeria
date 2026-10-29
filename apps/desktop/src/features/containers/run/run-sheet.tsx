import { IconPlayerPlay, IconTerminal2 } from "@tabler/icons-react";
import { useNavigate } from "@tanstack/react-router";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";

import { copyText } from "@/lib/clipboard";
import { errorMessage } from "@/lib/ipc/errors";
import { Banner } from "@/ui/banner";
import { Button } from "@/ui/button";
import { Field, Input } from "@/ui/field";
import { Kbd } from "@/ui/kbd";
import { Segmented } from "@/ui/segmented";
import { Sheet } from "@/ui/sheet";

import { useContainers } from "../api";
import { useRunContainer, useRunSheet } from "./api";
import { ImageField } from "./image-field";
import { EnvEditor, PortsEditor, StorageEditor } from "./row-editors";
import {
  dockerRun,
  emptyForm,
  nextHostPort,
  type RunForm,
  suggestedName,
  toSpec,
  usedPorts,
  validate,
} from "./run-model";

const RESTART = [
  { value: "no", label: "Never" },
  { value: "onFailure", label: "On failure" },
  { value: "unlessStopped", label: "Unless stopped" },
  { value: "always", label: "Always" },
] as const;

function Form({
  id,
  form,
  setForm,
  errors,
}: {
  id: string;
  form: RunForm;
  setForm: (form: RunForm) => void;
  errors: ReturnType<typeof validate>;
}) {
  const { data: containers } = useContainers();
  const used = usedPorts(containers ?? []);
  return (
    <div className="flex flex-col gap-4">
      <ImageField
        id={`${id}-image`}
        value={form.image}
        onChange={(image) => setForm({ ...form, image })}
        error={errors.image}
      />
      <Field
        label="Name"
        htmlFor={`${id}-name`}
        error={errors.name}
        hint="Leave empty to name it after the image."
      >
        <Input
          id={`${id}-name`}
          value={form.name}
          placeholder={suggestedName(form.image) || "Generated from the image"}
          onChange={(event) => setForm({ ...form, name: event.target.value })}
          className="font-mono text-mono-13"
          spellCheck={false}
        />
      </Field>
      <PortsEditor
        rows={form.ports}
        onChange={(ports) => setForm({ ...form, ports })}
        error={errors.ports}
        nextPort={() => nextHostPort(form.ports, used)}
      />
      <EnvEditor rows={form.env} onChange={(env) => setForm({ ...form, env })} error={errors.env} />
      <StorageEditor
        rows={form.storage}
        onChange={(storage) => setForm({ ...form, storage })}
        error={errors.storage}
      />
      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col items-start gap-1.5">
          <span aria-hidden className="text-13 font-medium text-ink-2">
            Restart
          </span>
          <Segmented
            label="Restart"
            size="sm"
            value={form.restart}
            onChange={(restart) => setForm({ ...form, restart })}
            options={[...RESTART]}
          />
        </div>
        <div className="flex flex-col items-start gap-1.5">
          <span aria-hidden className="text-13 font-medium text-ink-2">
            Platform
          </span>
          <Segmented
            label="Platform"
            size="sm"
            value={form.amd64 ? "amd64" : "arm64"}
            onChange={(platform) => setForm({ ...form, amd64: platform === "amd64" })}
            options={[
              { value: "arm64", label: "arm64" },
              { value: "amd64", label: "amd64 · Rosetta" },
            ]}
          />
        </div>
      </div>
      <Field label="Command" htmlFor={`${id}-command`} hint="Replaces the image's default command.">
        <Input
          id={`${id}-command`}
          value={form.command}
          placeholder="Image default"
          onChange={(event) => setForm({ ...form, command: event.target.value })}
          className="font-mono text-mono-13"
          spellCheck={false}
        />
      </Field>
    </div>
  );
}

function RunSheetBody() {
  const id = useId();
  const open = useRunSheet((state) => state.open);
  const hide = useRunSheet((state) => state.hide);
  const navigate = useNavigate();
  const run = useRunContainer();
  const { data: containers } = useContainers();
  const [form, setForm] = useState<RunForm>(() => ({
    ...emptyForm,
    image: useRunSheet.getState().image,
  }));
  const [submitted, setSubmitted] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey && event.key === "Enter") {
        event.preventDefault();
        formRef.current?.requestSubmit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  const errors = submitted ? validate(form, usedPorts(containers ?? [])) : {};
  const close = () => {
    hide();
    setForm(emptyForm);
    setSubmitted(false);
    run.reset();
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (run.isPending) {
      return;
    }
    setSubmitted(true);
    if (Object.keys(validate(form, usedPorts(containers ?? []))).length > 0) {
      return;
    }
    const spec = toSpec(form);
    run.mutate(spec, {
      onSuccess: (container) => {
        toast.success(`Started ${spec.name ?? spec.image}`);
        close();
        navigate({ to: "/containers/$id", params: { id: container } }).catch(() => undefined);
      },
    });
  };
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => (next ? undefined : close())}
      title="Run container"
      width="lg"
      footer={
        <>
          <Button
            variant="ghost"
            size="sm"
            className="mr-auto"
            onClick={() => copyText("Command", dockerRun(form))}
          >
            <IconTerminal2 />
            Copy as docker run
          </Button>
          <Button onClick={close}>Cancel</Button>
          <Button variant="brand" type="submit" form={id} loading={run.isPending}>
            <IconPlayerPlay />
            {run.isPending ? "Pulling and starting…" : "Run"}
            <Kbd className="bg-white/15 text-inherit shadow-none">⌘↵</Kbd>
          </Button>
        </>
      }
    >
      <form ref={formRef} id={id} onSubmit={submit}>
        {run.error ? (
          <Banner tone="bad" className="mb-4">
            {errorMessage(run.error)}
          </Banner>
        ) : null}
        <Form id={id} form={form} setForm={setForm} errors={errors} />
      </form>
    </Sheet>
  );
}

/** Pick an image, publish ports, set variables and storage, and run it: `docker run` with a face. */
export function RunSheet() {
  const session = useRunSheet((state) => state.session);
  return <RunSheetBody key={session} />;
}
