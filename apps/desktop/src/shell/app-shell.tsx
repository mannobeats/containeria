import { Outlet, useMatches } from "@tanstack/react-router";
import clsx from "clsx";

import { useEngineEvents } from "@/app/use-engine-events";
import { ComposeDropTarget } from "@/features/compose/compose-drop-target";
import { ComposeRunSheet } from "@/features/compose/compose-run-sheet";
import { ComposeSheet } from "@/features/compose/compose-sheet";
import { RunSheet } from "@/features/containers/run/run-sheet";
import { EngineGate } from "@/features/engine/engine-gate";
import { DockerfileDropTarget } from "@/features/images/dockerfile-drop-target";
import { useFirstLaunch } from "@/features/welcome/use-first-launch";
import { Toaster } from "@/ui/toaster";
import { TooltipProvider } from "@/ui/tooltip";

import { CommandPalette } from "./command-palette";
import { Sidebar } from "./sidebar";
import { useUi } from "./ui-store";
import { useMenuCommands } from "./use-menu-commands";
import { useMenuNavigation } from "./use-menu-navigation";
import { useShortcuts } from "./use-shortcuts";

/** The window: sidebar over the macOS vibrancy, the current view beside it. */
export function AppShell() {
  useEngineEvents();
  useShortcuts();
  useMenuNavigation();
  useMenuCommands();
  useFirstLaunch();
  const collapsed = useUi((state) => state.sidebarCollapsed);
  const matches = useMatches();
  const leaf = matches.at(-1);
  const needsEngine = matches.some((match) => match.staticData.needsEngine);
  const bare = matches.some((match) => match.staticData.bare);
  const hidden = collapsed || bare;
  return (
    <TooltipProvider>
      <div
        className={clsx(
          "grid h-full transition-[grid-template-columns] duration-220 ease-out",
          hidden ? "grid-cols-[0px_minmax(0,1fr)]" : "grid-cols-[236px_minmax(0,1fr)]",
        )}
      >
        <div
          inert={hidden}
          className={clsx(
            "flex min-h-0 min-w-0 flex-col overflow-hidden transition-opacity duration-140 [&>aside]:flex-1",
            hidden && "opacity-0",
          )}
        >
          <Sidebar />
        </div>
        <div className="relative flex min-h-0 min-w-0 flex-col bg-bg">
          {needsEngine ? (
            <EngineGate title={leaf?.staticData.title ?? ""}>
              <Outlet />
            </EngineGate>
          ) : (
            <Outlet />
          )}
        </div>
      </div>
      <CommandPalette />
      <RunSheet />
      <ComposeSheet />
      <ComposeRunSheet />
      <ComposeDropTarget />
      <DockerfileDropTarget />
      <Toaster />
    </TooltipProvider>
  );
}
