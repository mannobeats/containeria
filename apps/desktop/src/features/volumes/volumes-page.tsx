import { IconPlus, IconTrash } from "@tabler/icons-react";
import { useState } from "react";

import { segmentColor } from "@/features/metrics/segment-color";
import { formatBytes, plural } from "@/lib/format";
import type { VolumeSummary } from "@/lib/ipc/bindings";
import { type Selection, useSelection, useSelectionKeys } from "@/lib/use-selection";
import { Crumb, Page } from "@/shell/page";
import { Button } from "@/ui/button";
import { DeleteManySheet } from "@/ui/delete-many-sheet";
import { EmptyState } from "@/ui/empty-state";
import { ListToolbar } from "@/ui/list-toolbar";
import { Lede, PageHeading } from "@/ui/page-heading";
import { Segmented } from "@/ui/segmented";
import { SelectionBar } from "@/ui/selection-bar";
import { HeadRow, SelectAll, Table } from "@/ui/table";
import { Tile } from "@/ui/tile";
import { UsageBar } from "@/ui/usage-bar";

import { pickBackup, useBackupVolume, useRemoveVolumes, useVolumes } from "./api";
import { matchesVolume, type VolumeFilter, volumeName, volumeStats } from "./model";
import { type VolumeDialog, VolumeDialogs } from "./volume-dialogs";
import { type VolumeHandlers, VolumeRow } from "./volume-row";

function Sizes({ volumes, onClean }: { volumes: VolumeSummary[]; onClean: () => void }) {
  const stats = volumeStats(volumes);
  const segments = volumes
    .filter((volume) => (volume.sizeBytes ?? 0) > 0)
    .toSorted((a, b) => (b.sizeBytes ?? 0) - (a.sizeBytes ?? 0))
    .map((volume) => ({
      id: volume.name,
      label: volumeName(volume),
      value: volume.sizeBytes ?? 0,
      color: segmentColor({
        kind: volume.project ? "project" : "standalone",
        label: volume.project ?? "",
      }),
    }));
  return (
    <>
      <div className="flex items-center gap-3">
        <Lede>
          <b className="tabular">{formatBytes(stats.totalBytes)}</b> in{" "}
          {plural(stats.count, "volume")}.{" "}
          {stats.unattached > 0
            ? `${stats.unattached} ${stats.unattached === 1 ? "isn't" : "aren't"} attached to any container (${formatBytes(stats.unattachedBytes)}).`
            : "All are attached."}
        </Lede>
        <Button
          size="sm"
          className="ml-auto shrink-0"
          disabled={stats.unattached === 0}
          onClick={onClean}
        >
          <IconTrash />
          Clean up
        </Button>
      </div>
      <UsageBar segments={segments} label="Volume sizes" format={formatBytes} />
    </>
  );
}

type VolumeTableProps = VolumeHandlers & { volumes: VolumeSummary[]; selection: Selection };

function VolumeTable({ volumes, selection, ...handlers }: VolumeTableProps) {
  return (
    <Table label="Volumes">
      <colgroup>
        <col className="w-11" />
        <col />
        <col className="w-[120px]" />
        <col className="w-[220px]" />
        <col className="w-[200px]" />
        <col className="w-[90px]" />
        <col className="w-[120px]" />
        <col className="w-[84px]" />
      </colgroup>
      <HeadRow>
        <SelectAll selection={selection} label="Select all volumes no container uses" />
        <th>Name</th>
        <th>Project</th>
        <th>Used by</th>
        <th>Mounted at</th>
        <th className="text-right!">Size</th>
        <th>Created</th>
        <th>
          <span className="sr-only">Actions</span>
        </th>
      </HeadRow>
      <tbody>
        {volumes.map((volume) => (
          <VolumeRow key={volume.name} volume={volume} selection={selection} {...handlers} />
        ))}
      </tbody>
    </Table>
  );
}

export function VolumesPage() {
  const { data: volumes } = useVolumes();
  const backup = useBackupVolume();
  const [filter, setFilter] = useState<VolumeFilter>("all");
  const [query, setQuery] = useState("");
  const [dialog, setDialog] = useState<VolumeDialog | null>(null);
  const all = volumes ?? [];
  const stats = volumeStats(all);
  const visible = all.filter((volume) => matchesVolume(volume, filter, query));
  const selection = useSelection(
    visible.filter((volume) => volume.usedBy.length === 0).map((volume) => volume.name),
  );
  const chosen = visible.filter((volume) => selection.has(volume.name));
  const [deleting, setDeleting] = useState<VolumeSummary[]>([]);
  const removeMany = useRemoveVolumes();
  useSelectionKeys(selection, () => setDeleting(chosen));
  const restoreInto = (volume: string | null) =>
    pickBackup()
      .then((file) => (file ? setDialog({ kind: "restore", file, volume }) : undefined))
      .catch(() => undefined);
  const create = (
    <span className="flex gap-2">
      <Button onClick={() => restoreInto(null)}>Restore…</Button>
      <Button variant="brand" onClick={() => setDialog({ kind: "new" })}>
        <IconPlus />
        New volume
      </Button>
    </span>
  );
  const handlers: VolumeHandlers = {
    onBackup: (volume) => backup.run(volume.name),
    onClone: (volume) => setDialog({ kind: "clone", volume }),
    onRestore: (volume) => restoreInto(volume.name),
    onDelete: (volume) => setDialog({ kind: "delete", volume }),
  };
  return (
    <Page crumbs={<Crumb>Volumes</Crumb>}>
      {volumes?.length === 0 ? (
        <EmptyState
          art={<Tile icon="volume" size="xl" />}
          title="No volumes yet"
          className="h-full"
          actions={create}
        >
          Volumes keep data when containers are recreated.
        </EmptyState>
      ) : (
        <>
          <PageHeading title="Volumes" action={create}>
            <Sizes volumes={all} onClean={() => setDialog({ kind: "prune" })} />
          </PageHeading>
          <ListToolbar
            query={query}
            onQuery={setQuery}
            placeholder="Filter volumes"
            filter={
              <Segmented
                label="Show"
                value={filter}
                onChange={setFilter}
                options={[
                  { value: "all", label: "All", count: stats.count },
                  { value: "used", label: "In use", count: stats.count - stats.unattached },
                  { value: "unused", label: "Unattached", count: stats.unattached },
                ]}
              />
            }
          />
          <div className="pb-[72px]">
            {volumes && visible.length === 0 ? (
              <EmptyState title="No volumes match this filter" />
            ) : (
              <VolumeTable volumes={visible} selection={selection} {...handlers} />
            )}
          </div>
          <SelectionBar count={chosen.length} label="Selected volumes" onClear={selection.clear}>
            <Button variant="dangerGhost" size="sm" onClick={() => setDeleting(chosen)}>
              <IconTrash />
              Delete
            </Button>
          </SelectionBar>
        </>
      )}
      <VolumeDialogs dialog={dialog} volumes={all} onClose={() => setDialog(null)} />
      <DeleteManySheet
        names={deleting.map(volumeName)}
        noun="volume"
        onCancel={() => setDeleting([])}
        onConfirm={() => {
          removeMany.mutate(deleting);
          setDeleting([]);
          selection.clear();
        }}
      >
        Their data is deleted with them. Back a volume up first if you may need it. This can't be
        undone.
      </DeleteManySheet>
    </Page>
  );
}
