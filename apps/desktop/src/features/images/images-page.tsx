import { IconDownload, IconTrash } from "@tabler/icons-react";
import { type ReactNode, useState } from "react";

import { useContainers } from "@/features/containers/api";
import { formatBytes } from "@/lib/format";
import type { ContainerSummary, ImageSummary } from "@/lib/ipc/bindings";
import { Crumb, Page } from "@/shell/page";
import { Button } from "@/ui/button";
import { EmptyState } from "@/ui/empty-state";
import { ListToolbar } from "@/ui/list-toolbar";
import { Lede, PageHeading } from "@/ui/page-heading";
import { Segmented } from "@/ui/segmented";
import { HeadRow, Table } from "@/ui/table";
import { Tile } from "@/ui/tile";
import { UsageBar, UsageLegend } from "@/ui/usage-bar";

import { useImages } from "./api";
import { type ImageDialog, ImageDialogs } from "./image-dialogs";
import { type ImageHandlers, ImageRow } from "./image-row";
import { type ImageFilter, type ImageStats, imageStats, matchesImage, usersOf } from "./model";
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

function ImageTable({
  images,
  containers,
  ...handlers
}: ImageHandlers & { images: ImageSummary[]; containers: ContainerSummary[] }) {
  return (
    <Table label="Images">
      <colgroup>
        <col />
        <col className="w-[120px]" />
        <col className="w-[130px]" />
        <col className="w-[90px]" />
        <col className="w-[130px]" />
        <col className="w-[220px]" />
        <col className="w-[84px]" />
      </colgroup>
      <HeadRow>
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
          <ImageRow key={image.id} image={image} users={usersOf(image, containers)} {...handlers} />
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
      <div className="pb-10">
        {visible.length === 0 ? (
          <EmptyState title="No images match this filter" />
        ) : (
          <ImageTable
            images={visible}
            containers={containers ?? []}
            onTag={(image) => onDialog({ kind: "tag", image })}
            onDelete={(image) => onDialog({ kind: "delete", image })}
          />
        )}
      </div>
    </>
  );
}

export function ImagesPage() {
  const { data: images } = useImages();
  const setSheet = useImageSheet((state) => state.setSheet);
  const [dialog, setDialog] = useState<ImageDialog | null>(null);
  const stats = imageStats(images ?? []);
  const pull = (
    <Button variant="brand" onClick={() => setSheet("pull")}>
      <IconDownload />
      Pull image
    </Button>
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
          Images you pull or build show up here.
        </EmptyState>
      ) : (
        <ImageList images={images ?? []} stats={stats} onDialog={setDialog} pull={pull} />
      )}
      <ImageDialogs dialog={dialog} stats={stats} onClose={() => setDialog(null)} />
    </Page>
  );
}
