import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { queryKeys } from "@/app/query-keys";
import { useToastedMutation } from "@/app/use-toasted-mutation";
import { isServing, useEngineStatus } from "@/features/engine/api";
import { commands, type OutputEvent } from "@/lib/ipc/bindings";
import { useStream } from "@/lib/ipc/use-stream";

import { runningCount } from "./model";

/** BuildKit announces no event for a build, so the history is polled: fast while one runs. */
export function useBuilds() {
  const { data: engine } = useEngineStatus();
  return useQuery({
    queryKey: queryKeys.builds,
    queryFn: commands.buildsList,
    enabled: isServing(engine?.phase),
    refetchInterval: (query) => (runningCount(query.state.data) > 0 ? 2000 : 10_000),
  });
}

export function useBuild(id: string) {
  return useQuery({
    queryKey: [...queryKeys.builds, id],
    queryFn: () => commands.buildDetail(id),
  });
}

/** Older lines drop off past this, so a huge build log can't grow the view without bound. */
const KEEP = 5000;

/** The build's output, followed live while it runs. The history refreshes when it ends. */
export function useBuildLogs(id: string) {
  const client = useQueryClient();
  const [lines, setLines] = useState<string[]>([]);
  useStream<OutputEvent>(
    id,
    (channel) => {
      setLines([]);
      return commands.buildLogs(id, channel);
    },
    (event) => {
      if (event.kind === "line") {
        setLines((current) => [...current.slice(-(KEEP - 1)), event.text]);
        return;
      }
      if (event.kind === "failed") {
        setLines((current) => [...current, event.message]);
      }
      client.invalidateQueries({ queryKey: queryKeys.builds }).catch(() => undefined);
    },
  );
  return lines;
}

export function useRemoveBuild() {
  return useToastedMutation({
    run: ({ id }: { id: string; name: string }) => commands.buildRemove(id),
    done: ({ name }) => `Removed ${name} from the history`,
    failed: "The build wasn't removed",
    invalidates: queryKeys.builds,
  });
}

export function useClearBuilds() {
  return useToastedMutation({
    run: () => commands.buildsClear(),
    done: () => "Cleared the build history",
    failed: "The history wasn't cleared",
    invalidates: queryKeys.builds,
  });
}
