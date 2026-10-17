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

import { formatBytes } from "@/lib/format";
import { commands, type MachineFile } from "@/lib/ipc/bindings";
import { errorMessage } from "@/lib/ipc/errors";
import { pathSteps } from "@/lib/paths";
import { Button } from "@/ui/button";
import { EmptyState } from "@/ui/empty-state";
import { IconAction } from "@/ui/icon-action";
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
  return (
    <li className="group/file grid h-[30px] grid-cols-[minmax(0,1fr)_90px_32px] items-center gap-3 border-b-[0.5px] border-line px-4 text-13 text-ink hover:bg-hover">
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
          <IconAction
            label="Download"
            target={entry.name}
            onClick={() =>
              download(machine, entry).catch((error: unknown) =>
                toast.error("Not saved", { description: errorMessage(error) }),
              )
            }
          >
            <IconDownload />
          </IconAction>
        </span>
      )}
    </li>
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
  const { data: entries, error } = useMachineFiles(name, path);
  const upload = async () => {
    const source = await open({ multiple: false, directory: false });
    if (typeof source === "string") {
      await commands.machineFileUpload(name, source, path);
      await client.invalidateQueries({ queryKey: machineKeys.files(name, path) });
      toast.success("Uploaded", { description: path });
    }
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b-[0.5px] border-line pr-3 pl-4">
        <Crumbs path={path} onOpen={setPath} />
        <Button
          size="sm"
          className="ml-auto"
          onClick={() =>
            upload().catch((failure: unknown) =>
              toast.error("Not uploaded", { description: errorMessage(failure) }),
            )
          }
        >
          <IconUpload />
          Upload
        </Button>
      </div>
      {error ? (
        <EmptyState title="This folder can't be read">{errorMessage(error)}</EmptyState>
      ) : (
        <ul
          aria-label={`Files in ${path}`}
          className="m-0 min-h-0 flex-1 list-none overflow-auto p-0"
        >
          {entries?.map((entry) => (
            <Row key={entry.path} machine={name} entry={entry} onOpen={setPath} />
          ))}
        </ul>
      )}
    </div>
  );
}
