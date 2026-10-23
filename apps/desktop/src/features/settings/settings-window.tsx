import {
  IconAdjustments,
  IconAdjustmentsHorizontal,
  IconBrandDocker,
  IconCpu,
  IconDatabase,
  IconInfoCircle,
  type IconProps,
} from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import type { ComponentType } from "react";

import { useEngineEvents } from "@/app/use-engine-events";
import { StoragePane } from "@/features/storage/storage-pane";
import { fitWindow } from "@/lib/fit-window";
import { commands, events, type SettingsPane } from "@/lib/ipc/bindings";
import { useTauriEvent } from "@/lib/ipc/use-tauri-event";
import { CxIcon } from "@/ui/cx-icon";
import { Toaster } from "@/ui/toaster";

import { AboutPane } from "./about-pane";
import { AdvancedPane } from "./advanced-pane";
import { DockerPane } from "./docker-pane";
import { EnginePane } from "./engine-pane";
import { GeneralPane } from "./general-pane";
import { KubernetesPane } from "./kubernetes-pane";

function KubeIcon() {
  return <CxIcon name="kube" />;
}

type Pane = {
  id: SettingsPane;
  label: string;
  icon: ComponentType<IconProps>;
  component: ComponentType;
};

const PANES: Pane[] = [
  { id: "general", label: "General", icon: IconAdjustments, component: GeneralPane },
  { id: "engine", label: "Engine", icon: IconCpu, component: EnginePane },
  { id: "storage", label: "Storage", icon: IconDatabase, component: StoragePane },
  { id: "kubernetes", label: "Kubernetes", icon: KubeIcon, component: KubernetesPane },
  { id: "docker", label: "Docker", icon: IconBrandDocker, component: DockerPane },
  { id: "advanced", label: "Advanced", icon: IconAdjustmentsHorizontal, component: AdvancedPane },
  { id: "about", label: "About", icon: IconInfoCircle, component: AboutPane },
];

const PANE_KEY = ["settings", "pane"];

/** The pane Rust says to show: read once on open, then pushed when the menu or a link asks. */
function useShownPane(): SettingsPane {
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: PANE_KEY, queryFn: commands.settingsPane });
  useTauriEvent(events.settingsPaneShown, (pane) => queryClient.setQueryData(PANE_KEY, pane));
  return data ?? "general";
}

/**
 * The Settings window, as macOS draws one: the pane's name in the title bar, a toolbar of panes
 * under it, and a window that takes each pane's height.
 */
export function SettingsWindow() {
  useEngineEvents();
  const shown = useShownPane();
  const pane = PANES.find((candidate) => candidate.id === shown) ?? (PANES[0] as Pane);
  const Content = pane.component;
  return (
    <div ref={fitWindow} className="flex max-h-[760px] flex-col bg-bg">
      <header
        data-tauri-drag-region
        className="shrink-0 border-b-[0.5px] border-line bg-panel-solid px-3 pb-2"
      >
        <h1
          data-tauri-drag-region
          className="m-0 h-[30px] text-center text-13 leading-[30px] font-semibold text-ink"
        >
          {pane.label}
        </h1>
        <nav aria-label="Settings" className="flex justify-center gap-1">
          {PANES.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-current={item.id === pane.id ? "page" : undefined}
              onClick={() => commands.settingsOpen(item.id).catch(() => undefined)}
              className={clsx(
                "flex w-[72px] flex-col items-center gap-1 rounded-md pt-1.5 pb-1 text-11 text-ink-2 [&_svg]:size-5",
                item.id === pane.id ? "bg-press text-ink [&_svg]:text-brand" : "[&_svg]:text-ink-3",
              )}
            >
              <item.icon />
              {item.label}
            </button>
          ))}
        </nav>
      </header>
      {/* A floor while a pane loads, so the window doesn't collapse to its toolbar and back. */}
      <div className="min-h-60 overflow-auto px-6 pt-5 pb-6">
        <Content />
      </div>
      <Toaster />
    </div>
  );
}
