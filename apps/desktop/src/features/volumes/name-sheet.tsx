import { useId, useState } from "react";

import { Button } from "@/ui/button";
import { Field, Input } from "@/ui/field";
import { Sheet } from "@/ui/sheet";

import { nameProblem } from "./model";

type NameSheetProps = {
  open: boolean;
  title: string;
  action: string;
  hint: string;
  initial?: string;
  taken: string[];
  pending: boolean;
  onClose: () => void;
  onSubmit: (name: string) => void;
};

/** Asks for a volume name, for a new volume or a clone. */
export function NameSheet({
  open,
  title,
  action,
  hint,
  initial = "",
  taken,
  pending,
  onClose,
  onSubmit,
}: NameSheetProps) {
  const ids = useId();
  const [name, setName] = useState(initial);
  const problem = nameProblem(name.trim(), taken);
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => (next ? undefined : onClose())}
      title={title}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="brand"
            type="submit"
            form={`${ids}-volume-name`}
            disabled={name.trim() === "" || problem !== null}
            loading={pending}
          >
            {action}
          </Button>
        </>
      }
    >
      <form
        id={`${ids}-volume-name`}
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(name.trim());
        }}
      >
        <Field
          label="Name"
          htmlFor={`${ids}-volume-name-input`}
          hint={hint}
          error={problem ?? undefined}
        >
          <Input
            id={`${ids}-volume-name-input`}
            autoFocus
            aria-invalid={problem !== null}
            className="font-mono text-mono-13"
            placeholder="shop_uploads"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
      </form>
    </Sheet>
  );
}
