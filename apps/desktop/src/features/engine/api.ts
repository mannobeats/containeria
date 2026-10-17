import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Channel } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { create } from "zustand";

import { queryKeys } from "@/app/query-keys";
import { commands, type EngineConfig, type EnginePhase, type LogLine } from "@/lib/ipc/bindings";
import { errorMessage } from "@/lib/ipc/errors";

export function useEngineStatus() {
  return useQuery({
    queryKey: queryKeys.engine,
    queryFn: commands.engineStatus,
    refetchInterval: 15_000,
  });
}

/** True while containers can be listed: Containeria's own engine or one set in the environment. */
export function isServing(phase: EnginePhase | undefined): boolean {
  return phase === "running" || phase === "external";
}

type BootLog = { lines: LogLine[]; push: (line: LogLine) => void; clear: () => void };

/** Colima's progress lines for the current start or stop, shown while it runs. */
export const useBootLog = create<BootLog>((set) => ({
  lines: [],
  push: (line) => set((state) => ({ lines: [...state.lines.slice(-200), line] })),
  clear: () => set({ lines: [] }),
}));

type Control = "start" | "stop" | "restart";

const run: Record<Control, (progress: Channel<LogLine>) => Promise<null>> = {
  start: commands.engineStart,
  stop: commands.engineStop,
  restart: commands.engineRestart,
};

const done: Record<Control, string> = {
  start: "Engine started",
  stop: "Engine stopped",
  restart: "Engine restarted",
};

export function useEngineControl() {
  const client = useQueryClient();
  const push = useBootLog((state) => state.push);
  const clear = useBootLog((state) => state.clear);
  return useMutation({
    mutationFn: async (control: Control) => {
      clear();
      const started = performance.now();
      await run[control](new Channel<LogLine>(push));
      return { control, seconds: (performance.now() - started) / 1000 };
    },
    onSuccess: ({ control, seconds }) => {
      toast.success(control === "stop" ? done.stop : `${done[control]} in ${seconds.toFixed(1)} s`);
    },
    onError: (error) =>
      toast.error("The engine didn't respond", { description: errorMessage(error) }),
    onSettled: () => client.invalidateQueries({ queryKey: queryKeys.engine }),
  });
}

export function useSaveEngineConfig() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (config: EngineConfig) => commands.engineSaveConfig(config),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.engine }),
    onError: (error) => toast.error("Settings weren't saved", { description: errorMessage(error) }),
  });
}
