import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { queryKeys } from "@/app/query-keys";
import { commands, type EngineConfig, type EnginePhase } from "@/lib/ipc/bindings";
import { errorMessage } from "@/lib/ipc/errors";

/** A root shell in the engine's VM, for `connectShell`. */
export const engineShell = commands.engineShell;

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

type Control = "start" | "stop" | "restart";

/**
 * Whether `control` makes sense in `phase`, wherever the engine is offered: the engine can't start
 * when it's missing or while a start or stop runs, and only Containeria's own engine can stop or
 * restart, running or asleep.
 */
export function canControl(control: Control, phase: EnginePhase | undefined): boolean {
  return control === "start"
    ? phase === "stopped" || phase === "notCreated" || phase === "broken"
    : phase === "running" || phase === "asleep";
}

const run: Record<Control, () => Promise<null>> = {
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
  return useMutation({
    mutationFn: async (control: Control) => {
      const started = performance.now();
      await run[control]();
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
