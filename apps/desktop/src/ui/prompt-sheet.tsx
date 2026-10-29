import { type FormEvent, useId, useState } from "react";

import { Button } from "./button";
import { Field, Input } from "./field";
import { Sheet } from "./sheet";

type PromptSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  label: string;
  initial: string;
  action: string;
  hint?: string;
  /** Returns a sentence when the value can't be used. */
  validate?: (value: string) => string | undefined;
  onSubmit: (value: string) => void;
};

type PromptFormProps = Pick<
  PromptSheetProps,
  "onOpenChange" | "label" | "initial" | "hint" | "validate" | "onSubmit"
> & { id: string };

/** Lives inside the sheet's content, so each opening starts again from `initial`. */
function PromptForm({
  id,
  onOpenChange,
  label,
  initial,
  hint,
  validate,
  onSubmit,
}: PromptFormProps) {
  const [value, setValue] = useState(initial);
  const [touched, setTouched] = useState(false);
  const error = touched ? validate?.(value.trim()) : undefined;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (!validate?.(value.trim())) {
      onSubmit(value.trim());
      onOpenChange(false);
    }
  };
  return (
    <form id={id} onSubmit={submit}>
      <Field label={label} htmlFor={`${id}-value`} hint={hint} error={error}>
        <Input
          id={`${id}-value`}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          aria-invalid={error ? true : undefined}
          className="font-mono text-mono-13"
          spellCheck={false}
        />
      </Field>
    </form>
  );
}

/** Asks for one value, like a new name or an image tag. */
export function PromptSheet({ open, title, action, ...form }: PromptSheetProps) {
  const id = useId();
  return (
    <Sheet
      open={open}
      onOpenChange={form.onOpenChange}
      title={title}
      footer={
        <>
          <Button onClick={() => form.onOpenChange(false)}>Cancel</Button>
          <Button variant="brand" type="submit" form={id}>
            {action}
          </Button>
        </>
      }
    >
      <PromptForm id={id} {...form} />
    </Sheet>
  );
}
