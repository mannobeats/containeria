import { IconAlertCircle, IconCircleCheck, IconLoader2 } from "@tabler/icons-react";
import { useState } from "react";

import { SettingsRow, SettingsSection } from "@/features/settings/settings-section";
import { plural } from "@/lib/format";
import type {
  ImportProgress,
  Inventory,
  ItemKind,
  MigrationPlan,
  MigrationSource,
  MovableVolume,
  SourceStatus,
} from "@/lib/ipc/bindings";
import { errorMessage } from "@/lib/ipc/errors";
import { logoFor } from "@/lib/logos";
import { Banner } from "@/ui/banner";
import { Button } from "@/ui/button";
import { Checkbox } from "@/ui/checkbox";
import { Chip } from "@/ui/chip";
import { ConfirmSheet } from "@/ui/confirm-sheet";
import { Progress } from "@/ui/progress";
import { Segmented } from "@/ui/segmented";
import { Switch } from "@/ui/switch";
import { Tile } from "@/ui/tile";

import { progressKey, useInventory, useMigration, useMigrationSources } from "./api";
import { listed, sourceKey, volumesInUse } from "./model";

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

function InUseWarning({ volumes, name }: { volumes: MovableVolume[]; name: string }) {
  if (volumes.length === 0) {
    return null;
  }
  const users = [...new Set(volumes.flatMap((volume) => volume.inUseBy))];
  return (
    <Banner tone="warn">
      {listed(volumes.map((volume) => volume.name))} {volumes.length === 1 ? "is" : "are"} in use by{" "}
      {listed(users)}, still running in {name}. A database copied while it writes may not start from
      the copy: stop {users.length === 1 ? "it" : "them"} there first, or copy anyway.
    </Banner>
  );
}

type CopyButtonProps = {
  count: number;
  inUse: MovableVolume[];
  pending: boolean;
  onCopy: () => void;
};

/** Copies at once, or asks first when a running container is using a volume being copied. */
function CopyButton({ count, inUse, pending, onCopy }: CopyButtonProps) {
  const [asking, setAsking] = useState(false);
  return (
    <>
      <Button
        variant="brand"
        size="lg"
        loading={pending}
        disabled={count === 0}
        onClick={() => (inUse.length > 0 ? setAsking(true) : onCopy())}
      >
        Copy {plural(count, "item")}
      </Button>
      <ConfirmSheet
        open={asking}
        onOpenChange={setAsking}
        title="Copy volumes in use?"
        action="Copy anyway"
        onConfirm={() => {
          setAsking(false);
          onCopy();
        }}
      >
        {listed(inUse.map((volume) => volume.name))} may be copied mid-write. The copy can miss the
        latest changes, or a database in it may need recovery when it starts.
      </ConfirmSheet>
    </>
  );
}

type ChoicesProps = {
  source: MigrationSource;
  name: string;
  inventory: Inventory;
  onDone: () => void;
  doneLabel: string;
};

function Choices({ source, name, inventory, onDone, doneLabel }: ChoicesProps) {
  const [images, setImages] = useState(() => new Set(inventory.images));
  const [volumes, setVolumes] = useState(
    () => new Set(inventory.volumes.map((volume) => volume.name)),
  );
  const [containers, setContainers] = useState(
    () => new Set(inventory.containers.map((container) => container.id)),
  );
  const [start, setStart] = useState(false);
  const migration = useMigration();
  const count = images.size + volumes.size + containers.size;
  const inUse = volumesInUse(inventory, volumes, containers);
  const plan: MigrationPlan = {
    images: [...images],
    volumes: [...volumes],
    containers: [...containers],
    start,
  };
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
        items={inventory.volumes.map((volume) => ({
          id: volume.name,
          label: volume.name,
          detail: volume.inUseBy.length > 0 ? "In use" : null,
        }))}
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
      <InUseWarning volumes={inUse} name={name} />
      <p className="m-0 text-12 text-ink-3">
        Nothing in {name} is changed or removed. Volumes are read through a short-lived helper
        container there.
      </p>
      <div className="flex justify-end gap-2">
        <Button size="lg" disabled={migration.isPending} onClick={onDone}>
          {migration.isSuccess ? doneLabel : "Skip"}
        </Button>
        {migration.isSuccess ? null : (
          <CopyButton
            count={count}
            inUse={inUse}
            pending={migration.isPending}
            onCopy={() => migration.mutate({ source, plan })}
          />
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
      ? `Start ${installed.map((source) => source.label).join(" or ")} to copy what's in it, then check again.`
      : "No other container engine is on this Mac, so there's nothing to bring over.";
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

function SourcesFailed({
  error,
  onRetry,
  onDone,
  doneLabel,
}: {
  error: unknown;
  onRetry: () => void;
  onDone: () => void;
  doneLabel: string;
}) {
  return (
    <>
      <Banner tone="bad">
        Containeria couldn't look for other container engines: {errorMessage(error)}
      </Banner>
      <div className="mt-8 flex justify-end gap-2">
        <Button size="lg" onClick={onRetry}>
          Check again
        </Button>
        <Button variant="brand" size="lg" onClick={onDone}>
          {doneLabel}
        </Button>
      </div>
    </>
  );
}

/** Another engine takes the Docker context when it starts; say so while one is up. */
function RunningAlongside({ running }: { running: SourceStatus[] }) {
  const names = running.map((source) => source.label);
  return (
    <Banner>
      {listed(names)} {names.length === 1 ? "is" : "are"} running next to Containeria. An engine
      that starts can make itself the Docker CLI's current context, and then <code>docker</code> and{" "}
      <code>docker compose</code> commands go to it instead of Containeria. Copy what you need, then
      stop {names.length === 1 ? "it" : "them"}.
    </Banner>
  );
}

type MigrationViewProps = { onDone: () => void; doneLabel?: string };

/** Copies images, volumes and containers from another engine on the Mac into Containeria. */
export function MigrationView({ onDone, doneLabel = "Continue" }: MigrationViewProps) {
  const { data: sources, error, refetch } = useMigrationSources();
  const running = (sources ?? []).filter((source) => source.running);
  const [picked, setPicked] = useState<string | null>(null);
  const current =
    running.find((status) => sourceKey(status.source) === picked) ?? running[0] ?? null;
  const { data: inventory } = useInventory(current?.source ?? null);
  const retry = () => refetch().catch(() => undefined);
  // Also after a failed Check again, which keeps the last sources; a running one stays on screen.
  if (error && current === null) {
    return <SourcesFailed error={error} onRetry={retry} onDone={onDone} doneLabel={doneLabel} />;
  }
  if (sources === undefined) {
    return <Progress label="Looking for other container engines" className="mx-auto w-60" />;
  }
  if (current === null) {
    return (
      <NothingRunning sources={sources} onRetry={retry} onDone={onDone} doneLabel={doneLabel} />
    );
  }
  return (
    <div className="flex flex-col gap-5">
      <RunningAlongside running={running} />
      {running.length > 1 ? (
        <Segmented
          label="Copy from"
          value={sourceKey(current.source)}
          onChange={setPicked}
          options={running.map((status) => ({
            value: sourceKey(status.source),
            label: status.label,
          }))}
        />
      ) : null}
      {inventory ? (
        <Choices
          key={sourceKey(current.source)}
          source={current.source}
          name={current.label}
          inventory={inventory}
          onDone={onDone}
          doneLabel={doneLabel}
        />
      ) : null}
    </div>
  );
}
