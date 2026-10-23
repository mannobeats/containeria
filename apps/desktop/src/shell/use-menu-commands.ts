import { useNavigate } from "@tanstack/react-router";

import { newDraft } from "@/features/compose/model";
import { chooseComposeFile, useCompose } from "@/features/compose/store";
import { useRunSheet } from "@/features/containers/run/api";
import { useConnectionSheet } from "@/features/data/connection-sheet-store";
import { useEngineControl } from "@/features/engine/api";
import { useImageSheet } from "@/features/images/sheet-store";
import { useNewMachineSheet } from "@/features/machines/new-machine-store";
import { collectDiagnostics } from "@/lib/diagnostics";
import { events, type MenuCommand } from "@/lib/ipc/bindings";
import { useTauriEvent } from "@/lib/ipc/use-tauri-event";

import { useUi } from "./ui-store";

type Tools = { go: (to: string) => void; engine: (control: "start" | "stop" | "restart") => void };

const HANDLERS: Record<MenuCommand, (tools: Tools) => void> = {
  runContainer: () => useRunSheet.getState().show(),
  newComposeProject: () => useCompose.getState().edit(newDraft()),
  openComposeFile: chooseComposeFile,
  pullImage: ({ go }) => {
    go("/images");
    useImageSheet.getState().setSheet("pull");
  },
  buildImage: ({ go }) => {
    go("/images");
    useImageSheet.getState().openBuild();
  },
  newMachine: ({ go }) => {
    go("/machines");
    useNewMachineSheet.getState().setOpen(true);
  },
  newConnection: ({ go }) => {
    go("/data");
    useConnectionSheet.getState().show();
  },
  startEngine: ({ engine }) => engine("start"),
  stopEngine: ({ engine }) => engine("stop"),
  restartEngine: ({ engine }) => engine("restart"),
  openEngineShell: ({ go }) => go("/engine/shell"),
  showShortcuts: () => useUi.getState().setShortcutsOpen(true),
  collectDiagnostics: collectDiagnostics,
};

/** The menu bar's commands: each opens its sheet, on its own page when the sheet lives there. */
export function useMenuCommands() {
  const navigate = useNavigate();
  const control = useEngineControl();
  useTauriEvent(events.menuCommand, (command) =>
    HANDLERS[command]({
      go: (to) => {
        navigate({ to }).catch(() => undefined);
      },
      engine: (verb) => control.mutate(verb),
    }),
  );
}
