import { useState } from "react";
import { plural } from "@/lib/format";
import { Button } from "@/ui/button";
import { Checkbox } from "@/ui/checkbox";
import { CodeEditor } from "@/ui/code-editor";
import { inputClass } from "@/ui/input-class";
import { Sheet } from "@/ui/sheet";

import { useApply } from "./api";

const EXAMPLE = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
spec:
  replicas: 2
  selector:
    matchLabels: { app: web }
  template:
    metadata:
      labels: { app: web }
    spec:
      containers:
        - name: web
          image: nginx:1.29
          ports: [{ containerPort: 80 }]
`;

type ApplySheetProps = {
  onClose: () => void;
  namespaces: string[];
  /** Prefilled manifest, as from "Edit and apply" on an object's YAML. */
  manifest?: string;
};

/** Server-side apply for a pasted manifest. Images built with Docker work without a registry. */
export function ApplySheet({ onClose, namespaces, manifest = EXAMPLE }: ApplySheetProps) {
  const [text, setText] = useState(manifest);
  const [namespace, setNamespace] = useState("default");
  const [dryRun, setDryRun] = useState(false);
  const apply = useApply();
  return (
    <Sheet
      open
      onOpenChange={(next) => (next ? undefined : onClose())}
      title="Apply YAML"
      description="Objects without a namespace go to the one picked below. Local Docker images work without pushing."
      width="lg"
      footer={
        <>
          <span className="mr-auto flex items-center gap-2 text-13">
            <Checkbox checked={dryRun} onCheckedChange={setDryRun} label="Dry run" />
            Dry run
          </span>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="brand"
            loading={apply.isPending}
            onClick={() =>
              apply.mutate(
                { manifest: text, namespace, dryRun },
                {
                  onSuccess: () => {
                    if (!dryRun) {
                      onClose();
                    }
                  },
                },
              )
            }
          >
            {dryRun ? "Check" : "Apply"}
          </Button>
        </>
      }
    >
      <CodeEditor
        value={text}
        onChange={setText}
        language="yaml"
        label="Manifest"
        className="h-[320px]"
      />
      <label className="mt-3 flex items-center gap-3 text-13 text-ink-2">
        Namespace
        <select
          value={namespace}
          onChange={(event) => setNamespace(event.target.value)}
          className={`${inputClass} w-52`}
        >
          {namespaces.map((name) => (
            <option key={name}>{name}</option>
          ))}
        </select>
      </label>
      {apply.data ? (
        <p className="m-0 mt-3 text-12 text-ok-ink">
          {plural(apply.data.length, "object")} accepted.
        </p>
      ) : null}
    </Sheet>
  );
}
