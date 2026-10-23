import {
  IconArrowBarToDown,
  IconClearAll,
  IconClock,
  IconCopy,
  IconDownload,
} from "@tabler/icons-react";
import { save } from "@tauri-apps/plugin-dialog";
import { useState } from "react";
import { toast } from "sonner";

import { copyText } from "@/lib/clipboard";
import { commands } from "@/lib/ipc/bindings";
import { errorMessage } from "@/lib/ipc/errors";
import { Button } from "@/ui/button";
import { EmptyState } from "@/ui/empty-state";
import { IconAction } from "@/ui/icon-action";
import { SearchField } from "@/ui/search-field";
import { Segmented } from "@/ui/segmented";

import { useLogs } from "./api";
import { LogList } from "./log-list";
import { countErrors, filterLines, type LevelFilter, toText } from "./logs-model";

async function download(name: string, text: string) {
  const destination = await save({ defaultPath: `${name}.log` });
  if (destination) {
    await commands.saveText(destination, text);
    toast.success("Saved", { description: destination });
  }
}

/** The container's output, live, with level colours, search and a level filter. */
export function LogsTab({ id, name }: { id: string; name: string }) {
  const { lines, clear } = useLogs(id);
  const [level, setLevel] = useState<LevelFilter>("all");
  const [query, setQuery] = useState("");
  const [follow, setFollow] = useState(true);
  const [timestamps, setTimestamps] = useState(true);
  const shown = filterLines(lines, level, query);
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2.5 border-b-[0.5px] border-line pr-3 pl-5">
        <Segmented
          label="Levels"
          size="sm"
          value={level}
          onChange={setLevel}
          options={[
            { value: "all", label: "All" },
            { value: "warnings", label: "Warnings" },
            { value: "errors", label: "Errors", count: countErrors(lines) },
          ]}
        />
        <SearchField
          value={query}
          onChange={setQuery}
          placeholder="Search logs"
          className="w-[240px]"
        />
        <span className="ml-auto flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="sm"
            aria-pressed={timestamps}
            onClick={() => setTimestamps(!timestamps)}
          >
            <IconClock />
            Times
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-pressed={follow}
            onClick={() => setFollow(!follow)}
            className={follow ? "text-brand-ink" : undefined}
          >
            <IconArrowBarToDown />
            Follow
          </Button>
          <IconAction label="Copy logs" onClick={() => copyText("Logs", toText(shown))}>
            <IconCopy />
          </IconAction>
          <IconAction
            label="Save logs"
            onClick={() =>
              download(name, toText(lines)).catch((error: unknown) =>
                toast.error("Couldn't save the logs", { description: errorMessage(error) }),
              )
            }
          >
            <IconDownload />
          </IconAction>
          <IconAction label="Clear" onClick={clear}>
            <IconClearAll />
          </IconAction>
        </span>
      </div>
      {shown.length === 0 ? (
        <EmptyState title={lines.length === 0 ? "No output yet" : "No lines match"}>
          {lines.length === 0
            ? "New lines appear here as the container writes them."
            : "Change the search or the level filter."}
        </EmptyState>
      ) : (
        <LogList
          lines={shown}
          query={query}
          timestamps={timestamps}
          follow={follow}
          onFollow={setFollow}
        />
      )}
    </div>
  );
}
