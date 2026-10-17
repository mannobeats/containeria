import { IconAlertTriangle, IconLayoutSidebarLeftCollapse, IconSearch } from "@tabler/icons-react";
import { Link, useNavigate } from "@tanstack/react-router";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import clsx from "clsx";
import type { ReactNode } from "react";
import { toast } from "sonner";

import { useContainers } from "@/features/containers/api";
import { isCrashed } from "@/features/containers/model";
import { SidebarConnections } from "@/features/data/sidebar-connections";
import { isServing, useEngineControl, useEngineStatus } from "@/features/engine/api";
import { useImages } from "@/features/images/api";
import { useFailingPods } from "@/features/kubernetes/api";
import { useMetrics } from "@/features/metrics/api";
import { MemoryLedger } from "@/features/metrics/memory-ledger";
import { useNetworks } from "@/features/networks/api";
import { useVolumes } from "@/features/volumes/api";
import { formatMemory, plural } from "@/lib/format";
import type { ContainerSummary, EnginePhase, EngineStatus } from "@/lib/ipc/bindings";
import { AppMark } from "@/ui/app-mark";
import { Button } from "@/ui/button";
import { CxIcon, type CxIconName } from "@/ui/cx-icon";
import { Kbd } from "@/ui/kbd";
import { Menu, type MenuEntry } from "@/ui/menu";
import { Tip } from "@/ui/tooltip";
import { navItemClass } from "./nav-item-class";
import type { Section } from "./sections";
import { useUi } from "./ui-store";

type ItemProps = {
  to: Section["to"];
  icon: CxIconName;
  label: string;
  count?: ReactNode;
  exact?: boolean;
};

function Item({ to, icon, label, count, exact = false }: ItemProps) {
  return (
    <Link to={to} activeOptions={{ exact }} className={navItemClass}>
      {({ isActive }) => (
        <>
          <CxIcon
            name={icon}
            accent={isActive}
            className={clsx("transition-colors", isActive ? "text-brand" : "text-ink-3")}
          />
          <span className="truncate">{label}</span>
          {count === undefined ? null : (
            <span className="ml-auto text-12 text-ink-3 tabular">{count}</span>
          )}
        </>
      )}
    </Link>
  );
}

function Group({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <div className="mt-3.5 first:mt-1">
      {label ? <div className="px-2 pb-1 text-11 font-semibold text-ink-3">{label}</div> : null}
      {children}
    </div>
  );
}

const phaseLine: Record<EnginePhase, string> = {
  missing: "Colima not found",
  notCreated: "Not set up yet",
  stopped: "Stopped",
  starting: "Starting…",
  running: "Running",
  stopping: "Stopping…",
  broken: "Needs attention",
  external: "Using another engine",
};

function engineLine(phase: EnginePhase | undefined, failed: boolean): string {
  if (phase) {
    return phaseLine[phase];
  }
  return failed ? "Couldn't check the engine" : "Checking…";
}

function engineLabel(status: EngineStatus | undefined): string {
  if (!status) {
    return "Engine";
  }
  if (status.phase === "external") {
    return "Docker engine from CONTAINERIA_DOCKER_SOCKET";
  }
  return `Engine · ${status.config.cpus} CPUs · ${status.config.memoryGib} GB`;
}

function EngineCard() {
  const navigate = useNavigate();
  const { data: status, isError } = useEngineStatus();
  const control = useEngineControl();
  const phase = status?.phase;
  const serving = isServing(phase);
  const entries: MenuEntry[] = [
    {
      kind: "label",
      label: engineLabel(status),
    },
    serving
      ? {
          label: "Stop Engine",
          onSelect: () => control.mutate("stop"),
          disabled: phase === "external",
        }
      : {
          label: "Start Engine",
          onSelect: () => control.mutate("start"),
          disabled: phase === "missing",
        },
    {
      label: "Restart Engine",
      onSelect: () => control.mutate("restart"),
      disabled: phase !== "running",
    },
    { kind: "separator" },
    {
      label: "Open Engine Shell",
      onSelect: () => navigate({ to: "/engine/shell" }).catch(() => undefined),
      disabled: phase !== "running",
    },
    {
      label: "Copy Docker Socket Path",
      onSelect: () => {
        const socket = status?.dockerSocket ?? "";
        writeText(socket)
          .then(() => toast("Copied", { description: socket }))
          .catch(() => undefined);
      },
    },
  ];
  return (
    <Menu entries={entries}>
      <button
        type="button"
        className="mx-2.5 mb-2 flex items-center gap-2.5 rounded-md px-2.5 py-2 text-left data-[state=open]:bg-sidebar-active"
      >
        <AppMark size={28} />
        <span className="min-w-0 flex-1">
          <b className="block text-13 leading-tight font-semibold text-ink">Containeria</b>
          <span
            className={clsx(
              "block text-12 leading-snug text-ink-3",
              (phase === "starting" || phase === "stopping") && "animate-pulse",
              phase === "broken" && "text-bad-ink",
            )}
          >
            {engineLine(phase, isError)}
          </span>
        </span>
      </button>
    </Menu>
  );
}

function MemoryFooter() {
  const { data: metrics } = useMetrics();
  const ledger = metrics?.ledger;
  return (
    <Link to="/activity" className="block rounded-[7px] px-2 pt-1.5 pb-2 no-underline">
      <span className="mb-1.5 flex justify-between text-12 text-ink-3">
        Memory
        <b className="font-medium text-ink tabular">
          {ledger ? `${formatMemory(ledger.usedBytes)} of ${formatMemory(ledger.totalBytes)}` : "—"}
        </b>
      </span>
      <MemoryLedger ledger={ledger} size="sm" />
    </Link>
  );
}

/** A warning beside Kubernetes while a pod is crash-looping or can't pull its image. */
function FailingPods() {
  const failing = useFailingPods().length;
  return failing > 0 ? (
    <IconAlertTriangle
      aria-label={`${plural(failing, "pod")} failing`}
      className="size-3.5 text-bad-ink"
    />
  ) : null;
}

/** Running containers, with a warning when one crashed. Nothing until the list has loaded. */
function containersCount(containers: ContainerSummary[] | undefined): ReactNode {
  if (!containers) {
    return undefined;
  }
  const visible = containers.filter((container) => container.pod === null);
  const running = visible.filter((container) => container.state === "running").length;
  const crashed = visible.filter(isCrashed).length;
  if (crashed === 0) {
    return running;
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      {running}
      <IconAlertTriangle aria-label={`${crashed} crashed`} className="size-3.5 text-bad-ink" />
    </span>
  );
}

export function Sidebar() {
  const toggle = useUi((state) => state.toggleSidebar);
  const openPalette = useUi((state) => state.setPaletteOpen);
  const { data: containers } = useContainers();
  const { data: images } = useImages();
  const { data: volumes } = useVolumes();
  const { data: networks } = useNetworks();
  return (
    <aside className="flex min-h-0 min-w-0 flex-col border-r-[0.5px] border-[light-dark(oklch(0_0_0/0.1),oklch(0_0_0/0.5))] bg-panel">
      <div
        data-tauri-drag-region
        className="flex h-[52px] shrink-0 items-center justify-end px-2.5"
      >
        <Tip label="Hide sidebar" kbd="⌘\">
          <Button
            variant="ghost"
            iconOnly
            onClick={toggle}
            aria-label="Hide sidebar"
            className="text-ink-3"
          >
            <IconLayoutSidebarLeftCollapse />
          </Button>
        </Tip>
      </div>
      <EngineCard />
      <button
        type="button"
        onClick={() => openPalette(true)}
        className="mx-2.5 mb-1.5 flex h-7 items-center gap-[7px] rounded-[7px] bg-sidebar-hover px-2 text-13 text-ink-3"
      >
        <IconSearch aria-hidden />
        <span className="truncate">Search</span>
        <Kbd className="ml-auto bg-transparent shadow-none">⌘K</Kbd>
      </button>
      <nav aria-label="Sections" className="min-h-0 flex-1 overflow-auto px-2.5 pt-1 pb-3">
        <Group>
          <Item
            to="/containers"
            icon="container"
            label="Containers"
            count={containersCount(containers)}
          />
          <Item to="/images" icon="image" label="Images" count={images?.length} />
          <Item to="/volumes" icon="volume" label="Volumes" count={volumes?.length} />
          <Item to="/networks" icon="network" label="Networks" count={networks?.length} />
          <Item to="/kubernetes" icon="kube" label="Kubernetes" count={<FailingPods />} />
          <Item to="/machines" icon="machine" label="Linux machines" />
        </Group>
        <Group label="Data">
          <Item to="/data" icon="data" label="All connections" exact />
          <SidebarConnections />
        </Group>
        <Group label="Mac">
          <Item to="/domains" icon="domain" label="Domains" />
          <Item to="/activity" icon="activity" label="Activity" />
        </Group>
      </nav>
      <div className="shrink-0 border-t-[0.5px] border-[light-dark(oklch(0_0_0/0.07),oklch(1_0_0/0.06))] px-2.5 pt-2.5 pb-3">
        <MemoryFooter />
      </div>
    </aside>
  );
}
