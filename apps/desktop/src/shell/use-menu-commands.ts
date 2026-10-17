import { useNavigate } from "@tanstack/react-router";

import { newDraft } from "@/features/compose/model";
import { chooseComposeFile, useCompose } from "@/features/compose/store";
import { useRunSheet } from "@/features/containers/run/api";
import { useConnectionSheet } from "@/features/data/connection-sheet-store";
import { useImageSheet } from "@/features/images/sheet-store";
import { useNewMachineSheet } from "@/features/machines/new-machine-store";
import { events, type MenuCommand } from "@/lib/ipc/bindings";
import { useTauriEvent } from "@/lib/ipc/use-tauri-event";

type Go = (to: string) => void;

const HANDLERS: Record<MenuCommand, (go: Go) => void> = {
  runContainer: () => useRunSheet.getState().show(),
  newComposeProject: () => useCompose.getState().edit(newDraft()),
  openComposeFile: chooseComposeFile,
  pullImage: (go) => {
    go("/images");
    useImageSheet.getState().setSheet("pull");
  },
  buildImage: (go) => {
    go("/images");
    useImageSheet.getState().openBuild();
  },
  newMachine: (go) => {
    go("/machines");
    useNewMachineSheet.getState().setOpen(true);
  },
  newConnection: (go) => {
    go("/data");
    useConnectionSheet.getState().show();
  },
};

/** The File menu's commands: each opens its sheet, on its own page when the sheet lives there. */
export function useMenuCommands() {
  const navigate = useNavigate();
  useTauriEvent(events.menuCommand, (command) =>
    HANDLERS[command]((to) => {
      navigate({ to }).catch(() => undefined);
    }),
  );
}
