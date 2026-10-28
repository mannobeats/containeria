import { IconDownload, IconHammer, IconTrash } from "@tabler/icons-react";
import { type ReactNode, useState } from "react";
import { useContainers } from "@/features/containers/api";
import { formatBytes } from "@/lib/format";
import type { ContainerSummary, ImageSummary } from "@/lib/ipc/bindings";
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
import { Tip } from "@/ui/tooltip";
import { UsageBar, UsageLegend } from "@/ui/usage-bar";

import { useImages, useRemoveImages } from "./api";
import type { ImageDialog } from "./image-actions";
import { ImageDialogs } from "./image-dialogs";
import { type ImageHandlers, ImageRow } from "./image-row";
import {
  type ImageFilter,
  type ImageStats,
  imageLabel,
  imageStats,
  matchesImage,
  usersOf,
} from "./model";
import { useImageSheet } from "./sheet-store";

function DiskUsage({ stats, onClean }: { stats: ImageStats; onClean: () => void }) {
  const reclaimable = stats.unused.bytes + stats.dangling.bytes;
  const segments = [
    { id: "used", label: "In use", value: stats.used.bytes, color: "var(--s1)" },
    { id: "unused", label: "Unused", value: stats.unused.bytes, color: "var(--s6)" },
    { id: "dangling", label: "Dangling", value: stats.dangling.bytes },
  ];
  return (
    <>
      <Lede>
        <b className="tabular">{formatBytes(stats.totalBytes)}</b> across{" "}
        {stats.used.count + stats.unused.count + stats.dangling.count} images.{" "}
        {reclaimable > 0 ? (
          <>
            <b className="tabular">{formatBytes(reclaimable)}</b> isn't used by any container.
          </>
        ) : (
          "Every image is in use."
        )}
      </Lede>
      <UsageBar segments={segments} label="Image disk usage" format={formatBytes} />
      <div className="flex items-center">
        <UsageLegend segments={segments} format={formatBytes} />
        <Button size="sm" className="ml-auto" disabled={reclaimable === 0} onClick={onClean}>
          <IconTrash />
          Clean up {formatBytes(reclaimable)}
        </Button>
      </div>
    </>
  );
}

type ImageTableProps = ImageHandlers & {
  images: ImageSummary[];
  containers: ContainerSummary[];
  selection: Selection;
};

function ImageTable({ images, containers, selection, ...handlers }: ImageTableProps) {
  return (
    <Table label="Images">
      <colgroup>
        <col className="w-11" />
        <col />
        <col className="w-[120px]" />
        <col className="w-[130px]" />
        <col className="w-[90px]" />
        <col className="w-[130px]" />
        <col className="w-[220px]" />
        <col className="w-[84px]" />
      </colgroup>
      <HeadRow>
        <SelectAll selection={selection} label="Select all images that aren't in use" />
        <th>Repository</th>
        <th>Tag</th>
        <th>Image ID</th>
        <th className="text-right!">Size</th>
        <th>Created</th>
        <th>Used by</th>
        <th>
          <span className="sr-only">Actions</span>
        </th>
      </HeadRow>
      <tbody>
        {images.map((image) => (
          <ImageRow
            key={image.id}
            image={image}
            users={usersOf(image, containers)}
            selection={selection}
            {...handlers}
          />
        ))}
      </tbody>
    </Table>
  );
}

function filterOptions(stats: ImageStats) {
  const all = stats.used.count + stats.unused.count + stats.dangling.count;
  return [
    { value: "all" as const, label: "All", count: all },
    { value: "used" as const, label: "In use", count: stats.used.count },
    { value: "unused" as const, label: "Unused", count: stats.unused.count },
    { value: "dangling" as const, label: "Dangling", count: stats.dangling.count },
  ];
}

type ImageListProps = {
  images: ImageSummary[];
  stats: ImageStats;
  onDialog: (dialog: ImageDialog) => void;
  pull: ReactNode;
};

function ImageList({ images, stats, onDialog, pull }: ImageListProps) {
  const { data: containers } = useContainers();
  const setSheet = useImageSheet((state) => state.setSheet);
  const [filter, setFilter] = useState<ImageFilter>("all");
  const [query, setQuery] = useState("");
  const visible = images.filter((image) => matchesImage(image, filter, query));
  const selection = useSelection(
    visible.filter((image) => image.containers === 0).map((image) => image.id),
  );
  const [deleting, setDeleting] = useState<ImageSummary[]>([]);
  const removeMany = useRemoveImages();
  const chosen = visible.filter((image) => selection.has(image.id));
  useSelectionKeys(selection, () => setDeleting(chosen));
  return (
    <>
      <PageHeading title="Images" action={pull}>
        <DiskUsage stats={stats} onClean={() => setSheet("prune")} />
      </PageHeading>
      <ListToolbar
        query={query}
        onQuery={setQuery}
        placeholder="Filter images"
        filter={
          <Segmented
            label="Show"
            value={filter}
            onChange={setFilter}
            options={filterOptions(stats)}
          />
        }
      />
      <div className="pb-[72px]">
        {visible.length === 0 ? (
          <EmptyState title="No images match this filter" />
        ) : (
          <ImageTable
            images={visible}
            containers={containers ?? []}
            selection={selection}
            onDialog={onDialog}
          />
        )}
      </div>
      <SelectionBar count={chosen.length} label="Selected images" onClear={selection.clear}>
        <Button variant="dangerGhost" size="sm" onClick={() => setDeleting(chosen)}>
          <IconTrash />
          Delete
        </Button>
      </SelectionBar>
      <DeleteManySheet
        names={deleting.map(imageLabel)}
        noun="image"
        onCancel={() => setDeleting([])}
        onConfirm={() => {
          removeMany.mutate(deleting);
          setDeleting([]);
          selection.clear();
        }}
      >
        Every tag on them is removed. Layers other images share stay. This can't be undone.
      </DeleteManySheet>
    </>
  );
}

export function ImagesPage() {
  const { data: images } = useImages();
  const setSheet = useImageSheet((state) => state.setSheet);
  const openBuild = useImageSheet((state) => state.openBuild);
  const [dialog, setDialog] = useState<ImageDialog | null>(null);
  const stats = imageStats(images ?? []);
  const pull = (
    <span className="flex gap-2">
      <Tip label="Build from a Dockerfile, or drop one on the window">
        <Button onClick={() => openBuild()}>
          <IconHammer />
          Build…
        </Button>
      </Tip>
      <Button variant="brand" onClick={() => setSheet("pull")}>
        <IconDownload />
        Pull image
      </Button>
    </span>
  );
  return (
    <Page crumbs={<Crumb>Images</Crumb>}>
      {images?.length === 0 ? (
        <EmptyState
          art={<Tile icon="image" size="xl" />}
          title="No images yet"
          className="h-full"
          actions={pull}
        >
          Images you pull or build show up here. Drop a Dockerfile on the window to build one.
        </EmptyState>
      ) : null}
      {images?.length ? (
        <ImageList images={images} stats={stats} onDialog={setDialog} pull={pull} />
      ) : null}
      <ImageDialogs dialog={dialog} stats={stats} onClose={() => setDialog(null)} />
    </Page>
  );
}
