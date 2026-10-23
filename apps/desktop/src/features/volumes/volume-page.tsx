import { IconArchive, IconCopyPlus, IconTrash } from "@tabler/icons-react";
import { getRouteApi, Link } from "@tanstack/react-router";
import { useState } from "react";

import { formatBytes } from "@/lib/format";
import type { VolumeSummary } from "@/lib/ipc/bindings";
import { Crumb, Page } from "@/shell/page";
import { ParentCrumb } from "@/shell/parent-crumb";
import { Button } from "@/ui/button";
import { EmptyState } from "@/ui/empty-state";
import { ResourceHeader } from "@/ui/resource-header";
import { Tile } from "@/ui/tile";

import { useBackupVolume, useVolumes } from "./api";
import { FileBrowser } from "./file-browser";
import { volumeName } from "./model";
import { type VolumeDialog, VolumeDialogs } from "./volume-dialogs";

const route = getRouteApi("/volumes/$name");

function Facts({ volume }: { volume: VolumeSummary }) {
  return (
    <>
      <span>
        {volume.sizeBytes === null ? "Size not measured yet" : formatBytes(volume.sizeBytes)}
      </span>
      <span>{volume.driver} driver</span>
      {volume.usedBy.length === 0 ? <span>Not attached</span> : null}
      {volume.usedBy.map((user) => (
        <span key={user.containerId}>
          Mounted in
          <Link
            to="/containers/$id"
            params={{ id: user.containerId }}
            className="text-brand-ink no-underline hover:underline"
          >
            {user.container}
          </Link>
          at <code className="font-mono text-mono-12">{user.mountedAt}</code>
        </span>
      ))}
    </>
  );
}

export function VolumePage() {
  const { name } = route.useParams();
  const { data: volumes } = useVolumes();
  const backup = useBackupVolume();
  const [dialog, setDialog] = useState<VolumeDialog | null>(null);
  const volume = volumes?.find((candidate) => candidate.name === name);
  const title = volume ? volumeName(volume) : name;
  const crumbs = (
    <>
      <ParentCrumb to="/volumes" label="Volumes" />
      <Crumb>{title}</Crumb>
    </>
  );
  if (volumes && !volume) {
    return (
      <Page crumbs={crumbs}>
        <EmptyState
          art={<Tile icon="volume" size="xl" />}
          title={`${name} was deleted`}
          className="h-full"
        />
      </Page>
    );
  }
  return (
    <Page crumbs={crumbs} flush>
      {volume ? (
        <ResourceHeader
          face={<Tile icon="volume" size="lg" />}
          title={volume.anonymous ? "Anonymous volume" : volume.name}
          meta={<Facts volume={volume} />}
          actions={
            <>
              <Button onClick={() => backup.run(volume.name)} loading={backup.saving}>
                <IconArchive />
                Back up
              </Button>
              <Button onClick={() => setDialog({ kind: "clone", volume })}>
                <IconCopyPlus />
                Clone
              </Button>
              <Button
                variant="dangerGhost"
                iconOnly
                aria-label="Delete volume"
                onClick={() => setDialog({ kind: "delete", volume })}
              >
                <IconTrash />
              </Button>
            </>
          }
        />
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col overflow-auto">
        <FileBrowser volume={name} />
      </div>
      <VolumeDialogs dialog={dialog} volumes={volumes ?? []} onClose={() => setDialog(null)} />
    </Page>
  );
}
