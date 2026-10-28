import { IconAlertTriangle } from "@tabler/icons-react";
import { open } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { useState } from "react";
import { toast } from "sonner";

import { SettingsRow, SettingsSection } from "@/features/settings/settings-section";
import { formatBytes } from "@/lib/format";
import type { DataLocation, UsageGroup } from "@/lib/ipc/bindings";
import { errorMessage } from "@/lib/ipc/errors";
import { Banner } from "@/ui/banner";
import { Button } from "@/ui/button";
import { ConfirmSheet } from "@/ui/confirm-sheet";
import { Progress } from "@/ui/progress";
import { Sheet } from "@/ui/sheet";

import {
  type CleanUp,
  checkDestination,
  type MoveState,
  useCleanUp,
  useDataLocation,
  useDiskUsage,
  useMoveData,
} from "./api";

/** A move waiting for the user to confirm: the folder picked and where the data would go. */
type Pending = { folder: string | null; target: string };

const STEP_LABELS = {
  stopping: "Stopping the engine and Linux machines…",
  starting: "Starting them again…",
} as const;

function Moving({ state }: { state: Exclude<MoveState, null> }) {
  const copying = state.step === "copying";
  return (
    <SettingsRow
      block
      label={
        copying
          ? `Moving ${formatBytes(state.copied)} of ${formatBytes(state.total)}`
          : STEP_LABELS[state.step]
      }
      hint="Keep Containeria open until it's done."
    >
      {copying ? (
        <Progress
          label="Moving the engine's data"
          value={state.copied / Math.max(state.total, 1)}
          className="w-full"
        />
      ) : (
        <Progress label="Moving the engine's data" className="w-full" />
      )}
    </SettingsRow>
  );
}

async function check(folder: string | null): Promise<Pending | null> {
  const target = await checkDestination(folder);
  return target === null ? null : { folder, target };
}

async function pickFolder(): Promise<Pending | null> {
  const folder = await open({
    directory: true,
    title: "Choose where the engine's data goes",
    prompt: "Choose",
  });
  return typeof folder === "string" ? check(folder) : null;
}

type LocationRowsProps = {
  location: DataLocation;
  onPending: (pending: Pending | null) => void;
};

function LocationRows({ location, onPending }: LocationRowsProps) {
  return (
    <>
      <SettingsRow
        label="Engine data"
        hint={`${formatBytes(location.sizeBytes)} of disk images for containers, Kubernetes and Linux machines.`}
      >
        <Button
          size="sm"
          disabled={!location.available}
          onClick={() => revealItemInDir(location.path).catch(() => undefined)}
        >
          Show in Finder
        </Button>
        <Button
          size="sm"
          onClick={() =>
            pickFolder().then(onPending, (error: unknown) =>
              toast.error("The folder picker didn't open", { description: errorMessage(error) }),
            )
          }
        >
          Change…
        </Button>
      </SettingsRow>
      <div className="selectable border-t-[0.5px] border-line px-3.5 py-2 font-mono text-mono-12 [overflow-wrap:anywhere] text-ink-3">
        {location.path}
      </div>
      {location.isDefault ? null : (
        <SettingsRow
          label="Default location"
          hint="Brings the data back to the Mac's own disk, in ~/.containeria."
        >
          <Button size="sm" onClick={() => check(null).then(onPending, () => undefined)}>
            Move Back
          </Button>
        </SettingsRow>
      )}
    </>
  );
}

function MoveSheet({
  pending,
  size,
  onCancel,
  onConfirm,
}: {
  pending: Pending | null;
  size: number;
  onCancel: () => void;
  onConfirm: (pending: Pending) => void;
}) {
  return (
    <Sheet
      open={pending !== null}
      onOpenChange={(next) => (next ? undefined : onCancel())}
      title="Move the engine's data?"
      description={
        <>
          Containeria stops the engine and Linux machines, moves {formatBytes(size)} to{" "}
          <b className="[overflow-wrap:anywhere]">{pending?.target}</b>, and starts them again.
          {pending?.folder ? " The engine can't start while that drive is disconnected." : null}
        </>
      }
      footer={
        <>
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant="brand" onClick={() => (pending ? onConfirm(pending) : undefined)}>
            Move Data
          </Button>
        </>
      }
    />
  );
}

const GROUPS: { kind: CleanUp; label: string; pick: (usage: UsageGroup) => string }[] = [
  { kind: "images", label: "Images", pick: (usage) => `${usage.count} images` },
  { kind: "containers", label: "Containers", pick: (usage) => `${usage.count} containers` },
  { kind: "volumes", label: "Volumes", pick: (usage) => `${usage.count} volumes` },
  { kind: "buildCache", label: "Build cache", pick: (usage) => `${usage.count} entries` },
];

const CONFIRM: Record<CleanUp, { title: string; body: string }> = {
  images: {
    title: "Remove unused images?",
    body: "Images no container uses are deleted. They download again when needed.",
  },
  containers: {
    title: "Remove stopped containers?",
    body: "Every stopped container is deleted, with the files written inside it. Volumes stay.",
  },
  volumes: {
    title: "Remove unused volumes?",
    body: "Volumes no container uses are deleted with the data in them. This can't be undone.",
  },
  buildCache: {
    title: "Clear the build cache?",
    body: "The next builds start from scratch and take longer.",
  },
};

function DiskUsageSection() {
  const { data: usage } = useDiskUsage();
  const cleanUp = useCleanUp();
  const [asking, setAsking] = useState<CleanUp | null>(null);
  if (!usage) {
    return null;
  }
  return (
    <SettingsSection
      title="Inside the engine"
      note="Cleaning up frees space inside the engine's disk."
    >
      {GROUPS.map((group) => {
        const numbers = usage[group.kind];
        return (
          <SettingsRow
            key={group.kind}
            label={group.label}
            hint={`${group.pick(numbers)} · ${formatBytes(numbers.sizeBytes)}, ${formatBytes(numbers.reclaimableBytes)} can be freed`}
          >
            <Button
              size="sm"
              disabled={numbers.reclaimableBytes === 0 && group.kind !== "containers"}
              loading={cleanUp.isPending && cleanUp.variables === group.kind}
              onClick={() => setAsking(group.kind)}
            >
              Clean Up…
            </Button>
          </SettingsRow>
        );
      })}
      <ConfirmSheet
        open={asking !== null}
        onOpenChange={(next) => (next ? undefined : setAsking(null))}
        title={asking ? CONFIRM[asking].title : ""}
        action="Remove"
        onConfirm={() => {
          if (asking) {
            cleanUp.mutate(asking);
          }
          setAsking(null);
        }}
      >
        {asking ? CONFIRM[asking].body : null}
      </ConfirmSheet>
    </SettingsSection>
  );
}

/** Where the engine's disks live, moving them, and what takes space inside the engine. */
export function StoragePane() {
  const { data: location } = useDataLocation();
  const move = useMoveData();
  const [pending, setPending] = useState<Pending | null>(null);
  return (
    <>
      {location && !location.available ? (
        <Banner tone="warn" icon={<IconAlertTriangle className="size-4" />} className="mb-4">
          The drive with the engine's data isn't connected. Connect it to start the engine.
        </Banner>
      ) : null}
      <SettingsSection
        title="Data location"
        note="Images, containers, volumes, the build cache, Kubernetes and Linux machines all live here. An external drive must be formatted APFS or Mac OS Extended."
      >
        {move.state ? <Moving state={move.state} /> : null}
        {location && !move.state ? (
          <LocationRows location={location} onPending={setPending} />
        ) : null}
      </SettingsSection>
      {move.state ? null : <DiskUsageSection />}
      <MoveSheet
        pending={pending}
        size={location?.sizeBytes ?? 0}
        onCancel={() => setPending(null)}
        onConfirm={(confirmed) => {
          setPending(null);
          move.start(confirmed.folder);
        }}
      />
    </>
  );
}
