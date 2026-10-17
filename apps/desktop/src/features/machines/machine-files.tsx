import {
  IconChevronRight,
  IconDownload,
  IconFile,
  IconFolder,
  IconUpload,
} from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { open, save } from "@tauri-apps/plugin-dialog";
import { useState } from "react";
import { toast } from "sonner";

import { copyText } from "@/lib/clipboard";
import { formatBytes } from "@/lib/format";
import { commands, type MachineFile } from "@/lib/ipc/bindings";
import { errorMessage } from "@/lib/ipc/errors";
import { pathSteps } from "@/lib/paths";
import { Button } from "@/ui/button";
import { EmptyState } from "@/ui/empty-state";
import { IconAction } from "@/ui/icon-action";
import { ContextMenu, type MenuEntry } from "@/ui/menu";
import { machineKeys, useMachineFiles } from "./api";

async function download(machine: string, entry: MachineFile) {
  const destination = await save({ defaultPath: entry.name });
  if (destination) {
    await commands.machineFileDownload(machine, entry.path, destination);
    toast.success(`Saved ${entry.name}`, { description: destination });
  }
}

function Row({
  machine,
  entry,
  onOpen,
}: {
  machine: string;
  entry: MachineFile;
  onOpen: (path: string) => void;
}) {
  const folder = entry.kind === "directory";
  const saveToMac = () =>
    download(machine, entry).catch((error: unknown) =>
      toast.error("Not saved", { description: errorMessage(error) }),
    );
  const menu: MenuEntry[] = [
    folder
      ? { label: "Open", onSelect: () => onOpen(entry.path) }
      : { label: "Download…", onSelect: saveToMac },
    { kind: "separator" },
    { label: "Copy Path", onSelect: () => copyText("Path", entry.path) },
    { label: "Copy Name", onSelect: () => copyText("Name", entry.name) },
  ];
  return (
    <ContextMenu entries={menu}>
      <li className="group/file grid h-[30px] grid-cols-[minmax(0,1fr)_90px_32px] items-center gap-3 border-b-[0.5px] border-line px-4 text-13 text-ink hover:bg-hover data-[state=open]:bg-hover">
        {folder ? (
          <button
            type="button"
            onClick={() => onOpen(entry.path)}
            className="flex min-w-0 items-center gap-2 text-left text-ink"
          >
            <IconFolder className="text-brand" aria-hidden />
            <span className="truncate">{entry.name}</span>
          </button>
        ) : (
          <span className="flex min-w-0 items-center gap-2">
            <IconFile className="text-ink-3" aria-hidden />
            <span className="truncate select-text">{entry.name}</span>
          </span>
        )}
        <span className="text-right text-12 text-ink-3 tabular">
          {folder ? "" : formatBytes(entry.sizeBytes)}
        </span>
        {folder ? null : (
          <span className="opacity-0 transition-opacity group-hover/file:opacity-100 group-focus-within/file:opacity-100">
            <IconAction label="Download" target={entry.name} onClick={saveToMac}>
              <IconDownload />
            </IconAction>
          </span>
        )}
      </li>
    </ContextMenu>
  );
}

function Crumbs({ path, onOpen }: { path: string; onOpen: (path: string) => void }) {
  return (
    <nav aria-label="Folder" className="flex min-w-0 items-center">
      {pathSteps(path).map((step, index) => (
        <span key={step.path} className="flex items-center">
          {index > 1 ? <IconChevronRight className="size-3.5 text-ink-4" aria-hidden /> : null}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onOpen(step.path)}
            aria-current={step.path === path ? "page" : undefined}
          >
            {step.label}
          </Button>
        </span>
      ))}
    </nav>
  );
}

/** The shell logs in as root, so browsing starts in root's home. */
const HOME = "/root";

/** Browse a running machine's files, download them to the Mac and upload into the open folder. */
export function MachineFiles({ name }: { name: string }) {
  const [path, setPath] = useState(HOME);
  const client = useQueryClient();
  const { data: entries, error, refetch } = useMachineFiles(name, path);
  const upload = async () => {
    const source = await open({ multiple: false, directory: false });
    if (typeof source === "string") {
      await commands.machineFileUpload(name, source, path);
      await client.invalidateQueries({ queryKey: machineKeys.files(name, path) });
      toast.success("Uploaded", { description: path });
    }
  };
  const uploadHere = () =>
    upload().catch((failure: unknown) =>
      toast.error("Not uploaded", { description: errorMessage(failure) }),
    );
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b-[0.5px] border-line pr-3 pl-4">
        <Crumbs path={path} onOpen={setPath} />
        <Button size="sm" className="ml-auto" onClick={uploadHere}>
          <IconUpload />
          Upload
        </Button>
      </div>
      {error ? (
        <EmptyState title="This folder can't be read">{errorMessage(error)}</EmptyState>
      ) : (
        <ContextMenu
          entries={[
            { label: "Upload…", onSelect: uploadHere },
            { label: "Refresh", onSelect: () => refetch() },
          ]}
        >
          <ul
            aria-label={`Files in ${path}`}
            className="m-0 min-h-0 flex-1 list-none overflow-auto p-0"
          >
            {entries?.map((entry) => (
              <Row key={entry.path} machine={name} entry={entry} onOpen={setPath} />
            ))}
          </ul>
        </ContextMenu>
      )}
    </div>
  );
}
