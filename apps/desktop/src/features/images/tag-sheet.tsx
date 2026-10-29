import { useId, useState } from "react";

import { Button } from "@/ui/button";
import { Field, Input } from "@/ui/field";
import { Sheet } from "@/ui/sheet";

import { useTagImage } from "./api";

type TagSheetProps = { image: { id: string; name: string } | null; onClose: () => void };

const REFERENCE =
  /^[a-z0-9]+([._-][a-z0-9]+)*(:\d+)?(\/[a-z0-9]+([._-][a-z0-9]+)*)*(:[\w][\w.-]{0,127})?$/;

/** Adds another name to an image, e.g. to push it to a registry. */
export function TagSheet({ image, onClose }: TagSheetProps) {
  const ids = useId();
  const [reference, setReference] = useState("");
  const tag = useTagImage();
  const invalid = reference !== "" && !REFERENCE.test(reference);
  const close = () => {
    setReference("");
    onClose();
  };
  return (
    <Sheet
      open={image !== null}
      onOpenChange={(open) => (open ? undefined : close())}
      title={`Tag ${image?.name ?? "image"}`}
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button
            variant="brand"
            type="submit"
            form={`${ids}-tag-image`}
            disabled={reference === "" || invalid}
            loading={tag.isPending}
          >
            Add tag
          </Button>
        </>
      }
    >
      <form
        id={`${ids}-tag-image`}
        onSubmit={(event) => {
          event.preventDefault();
          if (image) {
            tag.mutate({ id: image.id, reference }, { onSuccess: close });
          }
        }}
      >
        <Field
          label="New reference"
          htmlFor={`${ids}-tag-reference`}
          hint="registry/namespace/name:tag"
          error={invalid ? "Use lowercase letters, digits, dots, dashes and slashes." : undefined}
        >
          <Input
            id={`${ids}-tag-reference`}
            autoFocus
            aria-invalid={invalid}
            className="font-mono text-mono-13"
            placeholder="ghcr.io/you/api:1.0"
            value={reference}
            onChange={(event) => setReference(event.target.value)}
          />
        </Field>
      </form>
    </Sheet>
  );
}
