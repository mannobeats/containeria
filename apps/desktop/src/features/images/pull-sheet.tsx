import { IconDownload } from "@tabler/icons-react";
import { useId, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/ui/button";
import { Field, Input } from "@/ui/field";
import { Sheet } from "@/ui/sheet";

import { type PullOutcome, useHubSearch, usePull } from "./api";
import { HubResults } from "./hub-results";
import { pullFraction, pullReference } from "./model";
import { PullProgress } from "./pull-progress";

function Picker({ form, onPull }: { form: string; onPull: (reference: string) => void }) {
  const [term, setTerm] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [tag, setTag] = useState("latest");
  const tagId = useId();
  const { data: results } = useHubSearch(term);
  const reference = pullReference(term, selected, tag);
  return (
    <form
      id={form}
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (reference) {
          onPull(reference);
        }
      }}
    >
      <Input
        autoFocus
        aria-label="Image to pull"
        placeholder="Search Docker Hub or paste ghcr.io/owner/name:tag"
        value={term}
        onChange={(event) => {
          setTerm(event.target.value);
          setSelected(null);
        }}
      />
      {term.trim().length > 1 ? (
        <HubResults results={results} term={term} selected={selected} onSelect={setSelected} />
      ) : null}
      {selected ? (
        <Field label="Tag" htmlFor={tagId} hint={`Pulls ${reference}`}>
          <Input
            id={tagId}
            className="font-mono text-mono-13"
            value={tag}
            onChange={(event) => setTag(event.target.value)}
          />
        </Field>
      ) : null}
    </form>
  );
}

type PullSheetProps = { open: boolean; onOpenChange: (open: boolean) => void };

/** Search Docker Hub or paste a reference, then watch each layer arrive. */
export function PullSheet({ open, onOpenChange }: PullSheetProps) {
  const form = useId();
  const pull = usePull(({ reference, failure }: PullOutcome) => {
    if (failure === null) {
      toast.success(`Pulled ${reference}`);
      onOpenChange(false);
    } else {
      toast.error(`Couldn't pull ${reference}`, { description: failure });
    }
  });
  const { state } = pull;
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          pull.cancel();
        }
        onOpenChange(next);
      }}
      title={state ? `Pulling ${state.reference}` : "Pull an image"}
      footer={
        state ? (
          <>
            <span className="mr-auto text-12 text-ink-3 tabular">
              {Math.round(pullFraction(state.layers) * 100)}%
            </span>
            <Button variant="dangerGhost" onClick={pull.cancel}>
              Cancel pull
            </Button>
          </>
        ) : (
          <>
            <span className="mr-auto text-12 text-ink-3">
              Pulls go to the engine's image store.
            </span>
            <Button onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button variant="brand" type="submit" form={form}>
              <IconDownload />
              Pull
            </Button>
          </>
        )
      }
    >
      {state ? <PullProgress layers={state.layers} /> : <Picker form={form} onPull={pull.start} />}
    </Sheet>
  );
}
