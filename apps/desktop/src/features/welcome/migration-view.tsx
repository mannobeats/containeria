import { IconAlertCircle, IconCircleCheck, IconLoader2 } from "@tabler/icons-react";
import { useState } from "react";

import { SettingsRow, SettingsSection } from "@/features/settings/settings-section";
import { plural } from "@/lib/format";
import type {
  ImportProgress,
  Inventory,
  ItemKind,
  MigrationSource,
  SourceStatus,
} from "@/lib/ipc/bindings";
import { logoFor } from "@/lib/logos";
import { Banner } from "@/ui/banner";
import { Button } from "@/ui/button";
import { Checkbox } from "@/ui/checkbox";
import { Chip } from "@/ui/chip";
import { Segmented } from "@/ui/segmented";
import { Switch } from "@/ui/switch";
import { Tile } from "@/ui/tile";

import { progressKey, useInventory, useMigration, useMigrationSources } from "./api";

const LABELS: Record<MigrationSource, string> = {
  dockerDesktop: "Docker Desktop",
  orbStack: "OrbStack",
};

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

type Item = { id: string; label: string; detail?: string | null; logo?: string };

type PickerProps = {
  title: string;
  kind: ItemKind;
  items: Item[];
  chosen: Set<string>;
  onChosen: (chosen: Set<string>) => void;
  progress: Record<string, ImportProgress>;
};

function Picker({ title, kind, items, chosen, onChosen, progress }: PickerProps) {
  if (items.length === 0) {
    return null;
  }
  const toggle = (id: string, on: boolean) => {
    const next = new Set(chosen);
    if (on) {
      next.add(id);
    } else {
      next.delete(id);
    }
    onChosen(next);
  };
  return (
    <SettingsSection title={`${title} · ${chosen.size} of ${items.length}`}>
      {items.map((item) => (
        <SettingsRow
          key={item.id}
          label={
            <span className="flex items-center gap-2">
              {item.logo ? <Tile logo={logoFor(item.logo)} icon="image" size="sm" /> : null}
              <span className="font-mono text-mono-13">{item.label}</span>
              {item.detail ? <Chip>{item.detail}</Chip> : null}
            </span>
          }
        >
          <Status progress={progress[progressKey(kind, item.id)]} />
          <Checkbox
            label={`Copy ${item.label}`}
            checked={chosen.has(item.id)}
            onCheckedChange={(on) => toggle(item.id, on)}
          />
        </SettingsRow>
      ))}
    </SettingsSection>
  );
}

type ChoicesProps = {
  source: MigrationSource;
  inventory: Inventory;
  onDone: () => void;
  doneLabel: string;
};

function Choices({ source, inventory, onDone, doneLabel }: ChoicesProps) {
  const [images, setImages] = useState(() => new Set(inventory.images));
  const [volumes, setVolumes] = useState(() => new Set(inventory.volumes));
  const [containers, setContainers] = useState(
    () => new Set(inventory.containers.map((container) => container.id)),
  );
  const [start, setStart] = useState(false);
  const migration = useMigration();
  const count = images.size + volumes.size + containers.size;
  const name = LABELS[source];
  return (
    <div className="flex flex-col gap-6">
      <Picker
        title="Images"
        kind="image"
        items={inventory.images.map((reference) => ({
          id: reference,
          label: reference,
          logo: reference,
        }))}
        chosen={images}
        onChosen={setImages}
        progress={migration.progress}
      />
      <Picker
        title="Volumes"
        kind="volume"
        items={inventory.volumes.map((volume) => ({ id: volume, label: volume }))}
        chosen={volumes}
        onChosen={setVolumes}
        progress={migration.progress}
      />
      <Picker
        title="Containers"
        kind="container"
        items={inventory.containers.map((container) => ({
          id: container.id,
          label: container.name,
          detail: container.project,
          logo: container.image,
        }))}
        chosen={containers}
        onChosen={setContainers}
        progress={migration.progress}
      />
      {containers.size > 0 ? (
        <SettingsSection
          note={`Both engines can't publish the same ports at once: quit ${name} or stop its containers first.`}
        >
          <SettingsRow
            label="Start containers that were running"
            hint="Otherwise they're created stopped, ready to start from the Containers list."
          >
            <Switch
              label="Start containers that were running"
              checked={start}
              onCheckedChange={setStart}
            />
          </SettingsRow>
        </SettingsSection>
      ) : null}
      <p className="m-0 text-12 text-ink-3">
        Nothing in {name} is changed or removed. Volumes are read through a short-lived helper
        container there.
      </p>
      <div className="flex justify-end gap-2">
        <Button size="lg" onClick={onDone}>
          {migration.isSuccess ? doneLabel : "Skip"}
        </Button>
        {migration.isSuccess ? null : (
          <Button
            variant="brand"
            size="lg"
            loading={migration.isPending}
            disabled={count === 0}
            onClick={() =>
              migration.mutate({
                source,
                plan: {
                  images: [...images],
                  volumes: [...volumes],
                  containers: [...containers],
                  start,
                },
              })
            }
          >
            Copy {plural(count, "item")}
          </Button>
        )}
      </div>
    </div>
  );
}

function NothingRunning({
  sources,
  onRetry,
  onDone,
  doneLabel,
}: {
  sources: SourceStatus[];
  onRetry: () => void;
  onDone: () => void;
  doneLabel: string;
}) {
  const installed = sources.filter((source) => source.installed);
  const message =
    installed.length > 0
      ? `Open ${installed.map((source) => LABELS[source.source]).join(" or ")} to copy what's in it, then check again.`
      : "Neither Docker Desktop nor OrbStack is installed on this Mac, so there's nothing to bring over.";
  return (
    <>
      <Banner>{message}</Banner>
      <div className="mt-8 flex justify-end gap-2">
        {installed.length > 0 ? (
          <Button size="lg" onClick={onRetry}>
            Check again
          </Button>
        ) : null}
        <Button variant="brand" size="lg" onClick={onDone}>
          {doneLabel}
        </Button>
      </div>
    </>
  );
}

type MigrationViewProps = { onDone: () => void; doneLabel?: string };

/** Copies images, volumes and containers from Docker Desktop or OrbStack into Containeria. */
export function MigrationView({ onDone, doneLabel = "Continue" }: MigrationViewProps) {
  const { data: sources = [], refetch } = useMigrationSources();
  const running = sources.filter((source) => source.running).map((source) => source.source);
  const [picked, setPicked] = useState<MigrationSource | null>(null);
  const source = picked && running.includes(picked) ? picked : (running[0] ?? null);
  const { data: inventory } = useInventory(source);
  if (source === null) {
    return (
      <NothingRunning
        sources={sources}
        onRetry={() => refetch().catch(() => undefined)}
        onDone={onDone}
        doneLabel={doneLabel}
      />
    );
  }
  return (
    <div className="flex flex-col gap-5">
      {running.length > 1 ? (
        <Segmented
          label="Copy from"
          value={source}
          onChange={setPicked}
          options={running.map((value) => ({ value, label: LABELS[value] }))}
        />
      ) : null}
      {inventory ? (
        <Choices
          key={source}
          source={source}
          inventory={inventory}
          onDone={onDone}
          doneLabel={doneLabel}
        />
      ) : null}
    </div>
  );
}
