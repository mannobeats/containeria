import {
  IconAdjustments,
  IconBrandDocker,
  IconCpu,
  IconInfoCircle,
  type IconProps,
} from "@tabler/icons-react";
import { getRouteApi, Link } from "@tanstack/react-router";
import type { ComponentType } from "react";

import { Page } from "@/shell/page";
import { CxIcon } from "@/ui/cx-icon";

import { AboutPane } from "./about-pane";
import { DockerPane } from "./docker-pane";
import { EnginePane } from "./engine-pane";
import { GeneralPane } from "./general-pane";
import { KubernetesPane } from "./kubernetes-pane";

const route = getRouteApi("/settings/$section");

function KubeIcon() {
  return <CxIcon name="kube" />;
}

type Pane = { id: string; label: string; icon: ComponentType<IconProps>; component: ComponentType };

const PANES: Pane[] = [
  { id: "general", label: "General", icon: IconAdjustments, component: GeneralPane },
  { id: "engine", label: "Engine", icon: IconCpu, component: EnginePane },
  { id: "kubernetes", label: "Kubernetes", icon: KubeIcon, component: KubernetesPane },
  { id: "docker", label: "Docker", icon: IconBrandDocker, component: DockerPane },
  { id: "about", label: "About", icon: IconInfoCircle, component: AboutPane },
];

export function SettingsPage() {
  const { section } = route.useParams();
  const pane = PANES.find((candidate) => candidate.id === section) ?? (PANES[0] as Pane);
  const Content = pane.component;
  return (
    <Page
      flush
      crumbs={
        <>
          <Link
            to="/settings/$section"
            params={{ section: "general" }}
            className="rounded-[5px] px-1 py-0.5 font-medium text-ink-3 no-underline hover:bg-hover hover:text-ink"
          >
            Settings
          </Link>
          <span aria-hidden className="text-ink-4">
            /
          </span>
          <b className="px-1 py-0.5 text-14 font-semibold text-ink">{pane.label}</b>
        </>
      }
    >
      <div className="grid min-h-0 flex-1 grid-cols-[200px_minmax(0,1fr)]">
        <nav
          aria-label="Settings sections"
          className="flex flex-col gap-px overflow-auto border-r-[0.5px] border-line bg-panel-solid px-2.5 py-3"
        >
          {PANES.map((item) => (
            <Link
              key={item.id}
              to="/settings/$section"
              params={{ section: item.id }}
              className="flex h-7 items-center gap-2 rounded-sm px-2 text-13 text-ink-2 no-underline transition-colors duration-140 hover:bg-sidebar-hover hover:text-ink data-[status=active]:bg-sidebar-active data-[status=active]:font-medium data-[status=active]:text-ink [&_svg]:text-ink-3 data-[status=active]:[&_svg]:text-brand"
            >
              <item.icon />
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="min-h-0 overflow-auto">
          <div className="max-w-[560px] px-7 pt-6 pb-12">
            <h1 className="m-0 mb-[18px] text-20 font-semibold tracking-[-0.012em] text-ink">
              {pane.label}
            </h1>
            <Content />
          </div>
        </div>
      </div>
    </Page>
  );
}
