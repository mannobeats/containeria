import { Outlet, useMatches } from "@tanstack/react-router";
import clsx from "clsx";

import { useEngineEvents } from "@/app/use-engine-events";
import { isServing, useEngineStatus } from "@/features/engine/api";
import { EngineOff } from "@/features/engine/engine-off";
import { useFirstLaunch } from "@/features/welcome/use-first-launch";
import { Toaster } from "@/ui/toaster";
import { TooltipProvider } from "@/ui/tooltip";

import { CommandPalette } from "./command-palette";
import { Page } from "./page";
import { Sidebar } from "./sidebar";
import { useUi } from "./ui-store";
import { useMenuNavigation } from "./use-menu-navigation";
import { useShortcuts } from "./use-shortcuts";

/** The window: sidebar over the macOS vibrancy, the current view beside it. */
export function AppShell() {
  useEngineEvents();
  useShortcuts();
  useMenuNavigation();
  useFirstLaunch();
  const collapsed = useUi((state) => state.sidebarCollapsed);
  const matches = useMatches();
  const leaf = matches.at(-1);
  const needsEngine = matches.some((match) => match.staticData.needsEngine);
  const bare = matches.some((match) => match.staticData.bare);
  const { data: engine } = useEngineStatus();
  const blocked = needsEngine && engine !== undefined && !isServing(engine.phase);
  return (
    <TooltipProvider>
      <div
        className={clsx(
          "grid h-full transition-[grid-template-columns] duration-220 ease-out",
          collapsed || bare ? "grid-cols-[0px_minmax(0,1fr)]" : "grid-cols-[236px_minmax(0,1fr)]",
        )}
      >
        <div
          className={clsx(
            "flex min-h-0 min-w-0 flex-col overflow-hidden transition-opacity duration-140 [&>aside]:flex-1",
            (collapsed || bare) && "pointer-events-none opacity-0",
          )}
        >
          <Sidebar />
        </div>
        <div className="relative flex min-h-0 min-w-0 flex-col bg-bg">
          {blocked ? (
            <Page
              crumbs={
                <b className="px-1 text-14 font-semibold text-ink">
                  {leaf?.staticData.title ?? ""}
                </b>
              }
            >
              <EngineOff phase={engine.phase} />
            </Page>
          ) : (
            <Outlet />
          )}
        </div>
      </div>
      <CommandPalette />
      <Toaster />
    </TooltipProvider>
  );
}
