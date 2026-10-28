import { IconFolderOpen, IconHammer } from "@tabler/icons-react";
import { open } from "@tauri-apps/plugin-dialog";
import { useId, useState } from "react";

import { startRun } from "@/features/compose/store";
import { commands } from "@/lib/ipc/bindings";
import { Button } from "@/ui/button";
import { Checkbox } from "@/ui/checkbox";
import { Field, Input } from "@/ui/field";
import { inputClass } from "@/ui/input-class";
import { Sheet } from "@/ui/sheet";

import { buildArgs, defaultTag } from "./build-model";
import { type BuildFrom, useImageSheet } from "./sheet-store";

type Form = {
  context: string;
  dockerfile: string;
  tag: string;
  args: string;
  noCache: boolean;
  pull: boolean;
};

function initialForm(from: BuildFrom | null): Form {
  const context = from?.context ?? "";
  return {
    context,
    dockerfile: from?.dockerfile ?? "",
    tag: context ? defaultTag(context) : "",
    args: "",
    noCache: false,
    pull: false,
  };
}

function build(form: Form) {
  const tag = form.tag.trim();
  startRun({
    title: `Building ${tag}`,
    done: `Built ${tag}`,
    start: (channel) =>
      commands.imageBuild(
        {
          context: form.context,
          dockerfile: form.dockerfile.trim() || null,
          tag,
          buildArgs: buildArgs(form.args),
          noCache: form.noCache,
          pull: form.pull,
        },
        channel,
      ),
  });
}

function BuildForm({ onClose }: { onClose: () => void }) {
  const id = useId();
  const [form, setForm] = useState(() => initialForm(useImageSheet.getState().build));
  const choose = () =>
    open({ directory: true, title: "Choose the folder to build" })
      .then((folder) => {
        if (typeof folder === "string") {
          setForm((current) => ({
            ...current,
            context: folder,
            dockerfile: folder === current.context ? current.dockerfile : "",
            tag: current.tag || defaultTag(folder),
          }));
        }
      })
      .catch(() => undefined);
  const ready = form.context !== "" && form.tag.trim() !== "";
  return (
    <Sheet
      open
      onOpenChange={(next) => (next ? undefined : onClose())}
      title="Build an image"
      description="Builds with BuildKit, the way docker build does. Drop a Dockerfile on the window to start here."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="brand"
            disabled={!ready}
            onClick={() => {
              onClose();
              build(form);
            }}
          >
            <IconHammer />
            Build
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field
          label="Folder"
          htmlFor={`${id}-context`}
          hint="Everything the Dockerfile copies comes from here."
        >
          <div className="flex gap-2">
            <Input
              id={`${id}-context`}
              readOnly
              value={form.context}
              placeholder="No folder chosen"
              className="flex-1 font-mono text-mono-12"
            />
            <Button onClick={choose}>
              <IconFolderOpen />
              Choose…
            </Button>
          </div>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Dockerfile" htmlFor={`${id}-file`}>
            <Input
              id={`${id}-file`}
              value={form.dockerfile}
              placeholder="Dockerfile"
              spellCheck={false}
              className="font-mono text-mono-12"
              onChange={(event) => setForm({ ...form, dockerfile: event.target.value })}
            />
          </Field>
          <Field label="Image name" htmlFor={`${id}-tag`}>
            <Input
              id={`${id}-tag`}
              value={form.tag}
              placeholder="shop-api:dev"
              spellCheck={false}
              autoCapitalize="off"
              className="font-mono text-mono-12"
              onChange={(event) => setForm({ ...form, tag: event.target.value })}
            />
          </Field>
        </div>
        <Field label="Build arguments" htmlFor={`${id}-args`} hint="One KEY=value per line.">
          <textarea
            id={`${id}-args`}
            rows={3}
            spellCheck={false}
            value={form.args}
            placeholder="NODE_ENV=production"
            className={`${inputClass} h-auto py-1.5 font-mono text-mono-12`}
            onChange={(event) => setForm({ ...form, args: event.target.value })}
          />
        </Field>
        <div className="flex gap-6 text-13 text-ink">
          <span className="flex items-center gap-2">
            <Checkbox
              checked={form.noCache}
              onCheckedChange={(noCache) => setForm({ ...form, noCache })}
              label="Ignore the build cache"
            />
            Ignore the build cache
          </span>
          <span className="flex items-center gap-2">
            <Checkbox
              checked={form.pull}
              onCheckedChange={(pull) => setForm({ ...form, pull })}
              label="Pull newer base images"
            />
            Pull newer base images
          </span>
        </div>
      </div>
    </Sheet>
  );
}

/** Build from a folder and Dockerfile, with the builder's output in the run sheet. */
export function BuildSheet() {
  const sheet = useImageSheet((state) => state.sheet);
  const setSheet = useImageSheet((state) => state.setSheet);
  return sheet === "build" ? <BuildForm onClose={() => setSheet(null)} /> : null;
}
