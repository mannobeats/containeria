import { useId, useState } from "react";

import { Button } from "@/ui/button";
import { Checkbox } from "@/ui/checkbox";
import { Field, Input } from "@/ui/field";
import { Sheet } from "@/ui/sheet";

import { useRestoreVolume } from "./api";
import { nameProblem, volumeFromBackup } from "./model";

type RestoreSheetProps = {
  file: string;
  /** The volume picked from its own menu; otherwise a name is suggested from the file. */
  volume: string | null;
  taken: string[];
  onClose: () => void;
};

/** Restores a `.tar.gz` backup (or any tar of a volume's files) into a new or existing volume. */
export function RestoreSheet({ file, volume, taken, onClose }: RestoreSheetProps) {
  const id = useId();
  const restore = useRestoreVolume();
  const [name, setName] = useState(() => volume ?? volumeFromBackup(file));
  const exists = taken.includes(name.trim());
  const [replace, setReplace] = useState(true);
  const problem = exists ? undefined : (nameProblem(name.trim(), taken) ?? undefined);
  return (
    <Sheet
      open
      onOpenChange={(next) => (next ? undefined : onClose())}
      title="Restore from backup"
      description={file}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant={exists && replace ? "danger" : "brand"}
            disabled={problem !== undefined || name.trim() === ""}
            loading={restore.isPending}
            onClick={() =>
              restore.mutate(
                { name: name.trim(), file, replace: exists && replace },
                { onSuccess: onClose },
              )
            }
          >
            {exists ? "Restore Into Volume" : "Create and Restore"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field
          label="Volume"
          htmlFor={id}
          error={problem}
          hint={exists ? "This volume exists." : "A new volume is created."}
        >
          <Input
            id={id}
            value={name}
            spellCheck={false}
            autoCapitalize="off"
            className="font-mono text-mono-13"
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        {exists ? (
          <span className="flex items-center gap-2 text-13 text-ink">
            <Checkbox
              checked={replace}
              onCheckedChange={setReplace}
              label="Delete its current files first"
            />
            Delete its current files first
          </span>
        ) : null}
      </div>
    </Sheet>
  );
}
