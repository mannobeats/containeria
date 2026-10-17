import { IconAlertCircle, IconCircleCheck, IconLoader2 } from "@tabler/icons-react";
import { useState } from "react";

import { SettingsRow, SettingsSection } from "@/features/settings/settings-section";
import type { DockerDesktop, ImportProgress } from "@/lib/ipc/bindings";
import { logoFor } from "@/lib/logos";
import { Banner } from "@/ui/banner";
import { Button } from "@/ui/button";
import { Checkbox } from "@/ui/checkbox";
import { Tile } from "@/ui/tile";

import { useDockerDesktop, useImportImages } from "./api";

function Status({ progress }: { progress: ImportProgress | undefined }) {
  if (!progress) {
    return null;
  }
  if (progress.state === "copying") {
    return <IconLoader2 className="animate-spin text-ink-3" aria-label="Copying" />;
  }
  if (progress.state === "failed") {
    return <IconAlertCircle className="text-bad-ink" aria-label={progress.message ?? "Failed"} />;
  }
  return <IconCircleCheck className="text-ok" aria-label="Copied" />;
}

function ImageList({ desktop, onDone }: { desktop: DockerDesktop; onDone: () => void }) {
  const [chosen, setChosen] = useState(() => new Set(desktop.images));
  const copy = useImportImages();
  const toggle = (reference: string, on: boolean) =>
    setChosen((current) => {
      const next = new Set(current);
      if (on) {
        next.add(reference);
      } else {
        next.delete(reference);
      }
      return next;
    });
  return (
    <>
      <SettingsSection note="Images are streamed from Docker Desktop's engine into Containeria's, the way docker save and docker load do. Docker Desktop isn't changed.">
        {desktop.images.map((reference) => (
          <SettingsRow
            key={reference}
            label={
              <span className="flex items-center gap-2 font-mono text-mono-13">
                <Tile logo={logoFor(reference)} icon="image" size="sm" />
                {reference}
              </span>
            }
          >
            <Status progress={copy.progress[reference]} />
            <Checkbox
              label={`Copy ${reference}`}
              checked={chosen.has(reference)}
              onCheckedChange={(on) => toggle(reference, on)}
            />
          </SettingsRow>
        ))}
      </SettingsSection>
      <div className="mt-8 flex justify-end gap-2">
        <Button size="lg" onClick={onDone}>
          {copy.isSuccess ? "Continue" : "Skip"}
        </Button>
        {copy.isSuccess ? null : (
          <Button
            variant="brand"
            size="lg"
            loading={copy.isPending}
            disabled={chosen.size === 0}
            onClick={() => copy.mutate([...chosen])}
          >
            Copy {chosen.size} {chosen.size === 1 ? "image" : "images"}
          </Button>
        )}
      </div>
    </>
  );
}

function NothingToImport({
  desktop,
  onRetry,
  onDone,
}: {
  desktop: DockerDesktop | undefined;
  onRetry: () => void;
  onDone: () => void;
}) {
  const message = desktop?.installed
    ? "Open Docker Desktop to copy its images, then check again."
    : "Docker Desktop isn't installed on this Mac, so there's nothing to bring over.";
  return (
    <>
      <Banner>{message}</Banner>
      <div className="mt-8 flex justify-end gap-2">
        {desktop?.installed ? (
          <Button size="lg" onClick={onRetry}>
            Check again
          </Button>
        ) : null}
        <Button variant="brand" size="lg" onClick={onDone}>
          Continue
        </Button>
      </div>
    </>
  );
}

/** Copies images from Docker Desktop so nothing has to be pulled again. */
export function StepImport({ onDone }: { onDone: () => void }) {
  const { data: desktop, refetch } = useDockerDesktop();
  return (
    <>
      <h1 className="m-0 text-24 font-semibold tracking-[-0.016em] text-ink">
        Bring your images over
      </h1>
      <p className="m-0 mt-2 mb-6 text-14 text-ink-2">
        Containers and volumes aren't copied: start them again from your Compose files, which keep
        working unchanged.
      </p>
      {desktop?.running && desktop.images.length > 0 ? (
        <ImageList desktop={desktop} onDone={onDone} />
      ) : (
        <NothingToImport
          desktop={desktop}
          onRetry={() => refetch().catch(() => undefined)}
          onDone={onDone}
        />
      )}
    </>
  );
}
