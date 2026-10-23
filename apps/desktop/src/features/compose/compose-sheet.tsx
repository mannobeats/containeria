import { IconFolderOpen } from "@tabler/icons-react";
import { useMutation } from "@tanstack/react-query";
import { useId } from "react";

import { type ComposePreview, commands } from "@/lib/ipc/bindings";
import { errorMessage } from "@/lib/ipc/errors";
import { Button } from "@/ui/button";
import { CodeEditor } from "@/ui/code-editor";
import { Field, Input } from "@/ui/field";
import { Sheet } from "@/ui/sheet";

import { type ComposeDraft, isProjectName, sourceOf } from "./model";
import { chooseComposeFile, startRun, useCompose } from "./store";

function Services({ preview }: { preview: ComposePreview }) {
  return (
    <ul aria-label="Services" className="m-0 mt-3 flex list-none flex-col p-0">
      {preview.services.map((service) => (
        <li
          key={service.name}
          className="flex h-8 items-center gap-3 border-t-[0.5px] border-line text-13 first:border-t-0"
        >
          <b className="w-36 truncate font-medium text-ink">{service.name}</b>
          <span className="min-w-0 flex-1 truncate text-ink-3">
            {service.builds ? "Built from a Dockerfile" : service.image}
          </span>
          <span className="font-mono text-mono-12 text-ink-3 tabular">
            {service.ports.join(", ")}
          </span>
        </li>
      ))}
    </ul>
  );
}

function deploy(draft: ComposeDraft) {
  startRun({
    title: `Deploying ${draft.name}`,
    done: `${draft.name} is up`,
    draft,
    start: (channel) => commands.composeDeploy(sourceOf(draft), draft.name, channel),
  });
}

function NameField({ name }: { name: string }) {
  const change = useCompose((state) => state.change);
  const id = useId();
  const error =
    name && !isProjectName(name) ? "Use lowercase letters, digits, - and _." : undefined;
  return (
    <div className="mb-3 w-64">
      <Field
        label="Project name"
        htmlFor={id}
        error={error}
        hint={name ? undefined : "Check fills it in from the file."}
      >
        <Input
          id={id}
          value={name}
          placeholder="shop"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          onChange={(event) => change({ name: event.target.value })}
        />
      </Field>
    </div>
  );
}

function useCheck(draft: ComposeDraft) {
  const change = useCompose((state) => state.change);
  return useMutation({
    mutationFn: () => commands.composePreview(sourceOf(draft), draft.name || null),
    onSuccess: (preview) => {
      if (!useCompose.getState().draft?.name) {
        change({ name: preview.name });
      }
    },
  });
}

function describe(draft: ComposeDraft): string {
  return draft.path
    ? `${draft.path}. Relative paths start from its folder.`
    : "Paste a compose.yaml, open one, or drop one on the window.";
}

function Editor({ draft }: { draft: ComposeDraft }) {
  const closeEditor = useCompose((state) => state.closeEditor);
  const change = useCompose((state) => state.change);
  const check = useCheck(draft);
  const edited = draft.path !== null && draft.text !== draft.saved;
  const footer = (
    <>
      {draft.project ? null : (
        <Button className="mr-auto" onClick={chooseComposeFile}>
          <IconFolderOpen />
          Open File…
        </Button>
      )}
      <Button onClick={closeEditor}>Cancel</Button>
      <Button loading={check.isPending} onClick={() => check.mutate()}>
        Check
      </Button>
      <Button
        variant="brand"
        disabled={!isProjectName(draft.name)}
        onClick={() => {
          closeEditor();
          deploy(draft);
        }}
      >
        {edited ? "Save and Deploy" : "Deploy"}
      </Button>
    </>
  );
  return (
    <Sheet
      open
      onOpenChange={(next) => (next ? undefined : closeEditor())}
      title={draft.project ? `Edit ${draft.project}` : "Deploy a Compose project"}
      description={describe(draft)}
      width="lg"
      footer={footer}
    >
      {draft.project ? null : <NameField name={draft.name} />}
      <CodeEditor
        value={draft.text}
        onChange={(text) => change({ text })}
        language="yaml"
        label="Compose file"
        className="h-[300px]"
      />
      {check.isError ? (
        <p role="alert" className="m-0 mt-3 font-mono text-mono-12 text-bad-ink">
          {errorMessage(check.error)}
        </p>
      ) : null}
      {check.data ? <Services preview={check.data} /> : null}
    </Sheet>
  );
}

/** The Compose editor: paste, open or drop a file, check it, deploy it. */
export function ComposeSheet() {
  const draft = useCompose((state) => state.draft);
  if (!draft) {
    return null;
  }
  return <Editor key={draft.path ?? draft.project ?? "pasted"} draft={draft} />;
}
