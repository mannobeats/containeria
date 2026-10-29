import { IconAlertTriangle, IconDots, IconLogs } from "@tabler/icons-react";
import { Link, useNavigate } from "@tanstack/react-router";
import clsx from "clsx";

import { useContainers } from "@/features/containers/api";
import { useMetrics } from "@/features/metrics/api";
import { formatAge, formatMemory } from "@/lib/format";
import type { PodSummary } from "@/lib/ipc/bindings";
import { Button } from "@/ui/button";
import { Chip } from "@/ui/chip";
import { rowActions } from "@/ui/classes";
import { type Column, ColumnTable } from "@/ui/column-table";
import { Dash } from "@/ui/dash";
import { IconAction } from "@/ui/icon-action";
import { Menu, type MenuEntry } from "@/ui/menu";
import { Tile } from "@/ui/tile";

import type { KubeSheet } from "./kube-sheet";
import { podMemory } from "./model";
import { podMenu, podTileState } from "./pod-actions";

type Open = (sheet: KubeSheet) => void;

function PodName({ pod }: { pod: PodSummary }) {
  return (
    <Link
      to="/kubernetes/pods/$namespace/$name"
      params={{ namespace: pod.namespace, name: pod.name }}
      className="flex min-w-0 items-center gap-2 text-inherit no-underline"
    >
      <Tile icon="pod" state={podTileState(pod)} />
      <span className="truncate font-medium text-ink">{pod.name}</span>
    </Link>
  );
}

function PodStatus({ pod }: { pod: PodSummary }) {
  if (!pod.problem) {
    return <span className={clsx(pod.status !== "Running" && "text-ink-3")}>{pod.status}</span>;
  }
  return (
    <span className="inline-flex items-center gap-1 text-bad-ink">
      <IconAlertTriangle className="size-3.5" aria-hidden />
      {pod.problem}
    </span>
  );
}

function PodActions({ pod, menu, logs }: { pod: PodSummary; menu: MenuEntry[]; logs: () => void }) {
  return (
    <span className={rowActions}>
      <IconAction label="Logs" target={pod.name} onClick={logs}>
        <IconLogs />
      </IconAction>
      <Menu entries={menu} align="end">
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          aria-label={`More for ${pod.name}`}
          className="text-ink-3 hover:text-ink"
        >
          <IconDots />
        </Button>
      </Menu>
    </span>
  );
}

type Show = (pod: PodSummary, tab?: string) => void;

function rowMenu(pod: PodSummary, show: Show, open: Open): MenuEntry[] {
  return [
    { label: "Open", onSelect: () => show(pod) },
    { label: "Logs", onSelect: () => show(pod, "logs") },
    {
      label: "Terminal",
      disabled: pod.status !== "Running",
      onSelect: () => show(pod, "terminal"),
    },
    { label: "Events", onSelect: () => show(pod, "events") },
    { kind: "separator" },
    ...podMenu(pod, open),
  ];
}

function columns(memory: Map<string, number>, show: Show, open: Open): Column<PodSummary>[] {
  const bytes = (pod: PodSummary) => memory.get(`${pod.namespace}/${pod.name}`);
  return [
    { header: "Name", cell: (pod) => <PodName pod={pod} /> },
    { header: "Namespace", width: "w-[140px]", cell: (pod) => <Chip>{pod.namespace}</Chip> },
    { header: "Status", width: "w-[170px]", cell: (pod) => <PodStatus pod={pod} /> },
    {
      header: "Ready",
      width: "w-[64px]",
      align: "right",
      cell: (pod) => `${pod.ready}/${pod.containers.length}`,
    },
    {
      header: "Restarts",
      width: "w-[76px]",
      align: "right",
      cell: (pod) => (
        <span className={clsx(pod.restarts > 5 && "text-bad-ink")}>{pod.restarts}</span>
      ),
    },
    {
      header: "Memory",
      width: "w-[88px]",
      align: "right",
      cell: (pod) => (bytes(pod) ? formatMemory(bytes(pod) ?? 0) : <Dash />),
    },
    {
      header: "Age",
      width: "w-[60px]",
      align: "right",
      cell: (pod) => <span className="text-ink-3">{formatAge(pod.createdAt)}</span>,
    },
    {
      header: "Actions",
      hiddenHeader: true,
      width: "w-[84px]",
      align: "right",
      cell: (pod) => (
        <PodActions pod={pod} menu={rowMenu(pod, show, open)} logs={() => show(pod, "logs")} />
      ),
    },
  ];
}

export function PodsTable({ pods, open }: { pods: PodSummary[]; open: Open }) {
  const { data: containers } = useContainers();
  const { data: metrics } = useMetrics();
  const navigate = useNavigate();
  const show: Show = (pod, tab) =>
    navigate({
      to: "/kubernetes/pods/$namespace/$name",
      params: { namespace: pod.namespace, name: pod.name },
      search: tab ? { tab } : {},
    });
  return (
    <ColumnTable
      label="Pods"
      columns={columns(podMemory(containers, metrics), show, open)}
      menu={(pod) => rowMenu(pod, show, open)}
      rows={pods}
      rowKey={(pod) => `${pod.namespace}/${pod.name}`}
      muted={(pod) => pod.status === "Completed"}
    />
  );
}
