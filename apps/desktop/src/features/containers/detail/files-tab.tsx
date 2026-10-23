import {
  IconDownload,
  IconFile,
  IconFolder,
  IconLink,
  IconRefresh,
  IconUpload,
} from "@tabler/icons-react";
import type { EventCallback } from "@tauri-apps/api/event";
import { type DragDropEvent, getCurrentWebview } from "@tauri-apps/api/webview";
import clsx from "clsx";
import { useState } from "react";

import { copyText } from "@/lib/clipboard";
import { formatBytes, formatRelative } from "@/lib/format";
import type { FileEntry } from "@/lib/ipc/bindings";
import { useTauriEvent } from "@/lib/ipc/use-tauri-event";
import { childPath, pathSteps } from "@/lib/paths";
import { Banner } from "@/ui/banner";
import { Button } from "@/ui/button";
import { EmptyState } from "@/ui/empty-state";
import { IconAction } from "@/ui/icon-action";
import { ContextMenu, type MenuEntry } from "@/ui/menu";
import { Skeleton } from "@/ui/progress";
import { useDownload, useFiles, useUpload } from "./api";

/** Files dragged onto the window from Finder. Tauri reports them for the whole webview. */
const dragDrop = {
  listen: (handler: EventCallback<DragDropEvent>) =>
    Promise.resolve().then(() => getCurrentWebview().onDragDropEvent(handler)),
};

const kindIcon = {
  directory: IconFolder,
  file: IconFile,
  symlink: IconLink,
  other: IconFile,
} as const;

function Breadcrumb({ path, onOpen }: { path: string; onOpen: (path: string) => void }) {
  return (
    <nav aria-label="Folder" className="flex min-w-0 items-center">
      {pathSteps(path).map((step, index, steps) => (
        <span key={step.path} className="flex items-center">
          {index > 1 ? <span className="px-0.5 text-ink-4">/</span> : null}
          <Button
            variant="ghost"
            size="sm"
            disabled={index === steps.length - 1}
            onClick={() => onOpen(step.path)}
            className="font-mono text-mono-12"
          >
            {step.label}
          </Button>
        </span>
      ))}
    </nav>
  );
}

type RowProps = {
  entry: FileEntry;
  path: string;
  onOpen: () => void;
  onDownload: () => void;
};

function Row({ entry, path, onOpen, onDownload }: RowProps) {
  const Icon = kindIcon[entry.kind];
  const folder = entry.kind === "directory";
  const menu: MenuEntry[] = [
    ...(folder ? [{ label: "Open", onSelect: onOpen }] : []),
    { label: folder ? "Download as .tar…" : "Download…", onSelect: onDownload },
    { kind: "separator" },
    { label: "Copy Path", onSelect: () => copyText("Path", path) },
    { label: "Copy Name", onSelect: () => copyText("Name", entry.name) },
  ];
  return (
    <ContextMenu entries={menu}>
      <tr className="group h-[30px] hover:bg-hover data-[state=open]:bg-hover [&>td]:border-b-[0.5px] [&>td]:border-line [&>td]:px-2.5">
        <td className="max-w-0 pl-4!">
          <button
            type="button"
            onClick={folder ? onOpen : onDownload}
            className={clsx(
              "flex min-w-0 items-center gap-2 text-left",
              folder ? "text-brand-ink" : "text-ink",
            )}
          >
            <Icon aria-hidden className={folder ? "text-brand" : "text-ink-3"} />
            <span className="truncate">{entry.name}</span>
          </button>
        </td>
        <td className="text-right text-ink-3 tabular">{folder ? "—" : formatBytes(entry.size)}</td>
        <td className="text-ink-3">{entry.modified > 0 ? formatRelative(entry.modified) : "—"}</td>
        <td className="font-mono text-mono-12 text-ink-3">{entry.permissions}</td>
        <td className="pr-3! text-right">
          <span className="opacity-0 transition-opacity duration-140 group-focus-within:opacity-100 group-hover:opacity-100">
            <IconAction
              label={folder ? "Save as .tar" : "Save"}
              target={entry.name}
              onClick={onDownload}
            >
              <IconDownload />
            </IconAction>
          </span>
        </td>
      </tr>
    </ContextMenu>
  );
}

/** Browse the container's filesystem, copy files out, and drop files from Finder in. */
export function FilesTab({ id }: { id: string }) {
  const [path, setPath] = useState("/");
  const [dragging, setDragging] = useState(false);
  const files = useFiles(id, path);
  const download = useDownload(id);
  const upload = useUpload(id);
  useTauriEvent(dragDrop, (event) => {
    setDragging(event.type === "enter" || event.type === "over");
    if (event.type === "drop" && event.paths.length > 0) {
      upload.mutate({ directory: path, sources: event.paths });
    }
  });
  return (
    <div className="relative flex h-full flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b-[0.5px] border-line pr-3 pl-4">
        <Breadcrumb path={path} onOpen={setPath} />
        <span className="ml-auto flex items-center gap-1">
          <IconAction label="Refresh" onClick={() => files.refetch()}>
            <IconRefresh />
          </IconAction>
          <Button
            size="sm"
            loading={upload.isPending}
            onClick={() => upload.mutate({ directory: path })}
          >
            <IconUpload />
            Upload
          </Button>
        </span>
      </div>
      <ContextMenu
        entries={[
          { label: "Upload…", onSelect: () => upload.mutate({ directory: path }) },
          { label: "Refresh", onSelect: () => files.refetch() },
        ]}
      >
        <div className="flex min-h-0 flex-1 flex-col">
          <FileList
            state={files}
            path={path}
            onOpen={(entry) => setPath(childPath(path, entry.name))}
            onDownload={(entry) =>
              download.mutate({
                path: childPath(path, entry.name),
                folder: entry.kind === "directory",
              })
            }
          />
        </div>
      </ContextMenu>
      {dragging ? (
        <div className="pointer-events-none absolute inset-2 z-[5] flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-brand bg-[color-mix(in_oklch,var(--brand-soft)_85%,transparent)] text-brand-ink animate-fade">
          <IconUpload aria-hidden className="size-7" />
          Drop to copy into <span className="font-mono text-mono-13">{path}</span>
        </div>
      ) : null}
    </div>
  );
}

type ListProps = {
  state: ReturnType<typeof useFiles>;
  path: string;
  onOpen: (entry: FileEntry) => void;
  onDownload: (entry: FileEntry) => void;
};

function FileList({ state, path, onOpen, onDownload }: ListProps) {
  if (state.isPending) {
    return <Skeleton className="m-4 w-64" />;
  }
  if (state.error) {
    return (
      <Banner tone="bad" className="m-4">
        This folder can't be read.
      </Banner>
    );
  }
  if (state.data.length === 0) {
    return (
      <EmptyState title="This folder is empty">
        Drop files here from Finder to copy them in.
      </EmptyState>
    );
  }
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <table className="w-full table-fixed border-separate border-spacing-0 text-13">
        <colgroup>
          <col />
          <col className="w-24" />
          <col className="w-32" />
          <col className="w-28" />
          <col className="w-14" />
        </colgroup>
        <thead>
          <tr className="[&>th]:sticky [&>th]:top-0 [&>th]:h-7 [&>th]:border-b-[0.5px] [&>th]:border-line [&>th]:bg-bg [&>th]:px-2.5 [&>th]:text-left [&>th]:text-12 [&>th]:font-medium [&>th]:text-ink-3">
            <th className="pl-4!">Name</th>
            <th className="text-right!">Size</th>
            <th>Modified</th>
            <th>Permissions</th>
            <th>
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {state.data.map((entry) => (
            <Row
              key={entry.name}
              entry={entry}
              path={childPath(path, entry.name)}
              onOpen={() => onOpen(entry)}
              onDownload={() => onDownload(entry)}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
