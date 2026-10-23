import { IconDownload, IconFile, IconFolder, IconLink } from "@tabler/icons-react";
import { useState } from "react";

import { copyText } from "@/lib/clipboard";
import { formatBytes, formatRelative } from "@/lib/format";
import type { VolumeFile } from "@/lib/ipc/bindings";
import { errorMessage } from "@/lib/ipc/errors";
import { Banner } from "@/ui/banner";
import { Dash } from "@/ui/dash";
import { EmptyState } from "@/ui/empty-state";
import { IconAction } from "@/ui/icon-action";
import { ContextMenu, type MenuEntry } from "@/ui/menu";
import { Skeleton } from "@/ui/progress";
import { HeadRow, Row, RowActions, Table } from "@/ui/table";

import { useDownloadFromVolume, useVolumeFiles } from "./api";
import { isFolder, joinPath } from "./model";

const icons = { directory: IconFolder, link: IconLink, file: IconFile, other: IconFile } as const;

function Breadcrumbs({
  volume,
  path,
  onOpen,
}: {
  volume: string;
  path: string;
  onOpen: (path: string) => void;
}) {
  const parts = path.split("/").filter(Boolean);
  return (
    <nav
      aria-label="Folder"
      className="flex min-w-0 items-center gap-1 px-5 py-2.5 text-13 text-ink-3"
    >
      <button
        type="button"
        className="rounded-[5px] px-1 hover:bg-hover hover:text-ink"
        onClick={() => onOpen("")}
      >
        {volume}
      </button>
      {parts.map((part, index) => (
        <span key={parts.slice(0, index + 1).join("/")} className="flex items-center gap-1">
          /
          <button
            type="button"
            className="rounded-[5px] px-1 hover:bg-hover hover:text-ink"
            onClick={() => onOpen(parts.slice(0, index + 1).join("/"))}
          >
            {part}
          </button>
        </span>
      ))}
    </nav>
  );
}

function EntryRow({
  entry,
  path,
  onOpen,
  onDownload,
}: {
  entry: VolumeFile;
  path: string;
  onOpen: () => void;
  onDownload: () => void;
}) {
  const Icon = icons[entry.kind];
  const menu: MenuEntry[] = [
    ...(isFolder(entry) ? [{ label: "Open", onSelect: onOpen }] : []),
    { label: "Download…", onSelect: onDownload },
    { kind: "separator" },
    { label: "Copy Path", onSelect: () => copyText("Path", `/${path}`) },
    { label: "Copy Name", onSelect: () => copyText("Name", entry.name) },
  ];
  return (
    <ContextMenu entries={menu}>
      <Row>
        <td className="max-w-0">
          {isFolder(entry) ? (
            <button
              type="button"
              onClick={onOpen}
              className="flex min-w-0 items-center gap-2 text-ink"
              data-row-link
            >
              <Icon className="text-ink-3" aria-hidden />
              <span className="truncate">{entry.name}</span>
            </button>
          ) : (
            <span className="flex min-w-0 items-center gap-2 text-ink">
              <Icon className="text-ink-3" aria-hidden />
              <span className="truncate select-text">{entry.name}</span>
            </span>
          )}
        </td>
        <td className="text-right tabular">
          {isFolder(entry) ? <Dash /> : formatBytes(entry.sizeBytes)}
        </td>
        <td className="text-ink-3">{formatRelative(entry.modifiedAt)}</td>
        <RowActions>
          <IconAction label="Save to the Mac" target={entry.name} onClick={onDownload}>
            <IconDownload />
          </IconAction>
        </RowActions>
      </Row>
    </ContextMenu>
  );
}

/** Browses a volume read-only and copies files out to the Mac. */
export function FileBrowser({ volume }: { volume: string }) {
  const [path, setPath] = useState("");
  const { data: entries, error, isPending, refetch } = useVolumeFiles(volume, path);
  const download = useDownloadFromVolume();
  return (
    <div className="flex min-h-0 flex-1 flex-col border-t-[0.5px] border-line">
      <Breadcrumbs volume={volume} path={path} onOpen={setPath} />
      <ContextMenu entries={[{ label: "Refresh", onSelect: () => refetch() }]}>
        <div className="flex min-h-0 flex-1 flex-col">
          {error ? (
            <Banner tone="bad" className="mx-5 mb-3">
              {errorMessage(error)}
            </Banner>
          ) : null}
          {isPending ? <Skeleton className="mx-5 w-64" /> : null}
          {entries?.length === 0 ? (
            <EmptyState title="This folder is empty" className="py-10" />
          ) : null}
          {entries && entries.length > 0 ? (
            <Table label={`Files in ${path || volume}`}>
              <colgroup>
                <col />
                <col className="w-[100px]" />
                <col className="w-[140px]" />
                <col className="w-[60px]" />
              </colgroup>
              <HeadRow>
                <th>Name</th>
                <th className="text-right!">Size</th>
                <th>Modified</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </HeadRow>
              <tbody>
                {entries.map((entry) => (
                  <EntryRow
                    key={entry.name}
                    entry={entry}
                    path={joinPath(path, entry.name)}
                    onOpen={() => setPath(joinPath(path, entry.name))}
                    onDownload={() =>
                      download.run({ name: volume, path: joinPath(path, entry.name) })
                    }
                  />
                ))}
              </tbody>
            </Table>
          ) : null}
        </div>
      </ContextMenu>
    </div>
  );
}
