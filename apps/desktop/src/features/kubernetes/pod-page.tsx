import { IconArrowsExchange, IconDots, IconX } from "@tabler/icons-react";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { openUrl } from "@tauri-apps/plugin-opener";

import { copyText } from "@/lib/clipboard";
import { formatAge, plural } from "@/lib/format";
import type { Cluster, PodSummary } from "@/lib/ipc/bindings";
import { Crumb, Page } from "@/shell/page";
import { ParentCrumb } from "@/shell/parent-crumb";
import { Button } from "@/ui/button";
import { Chip } from "@/ui/chip";
import { EmptyState } from "@/ui/empty-state";
import { IconAction } from "@/ui/icon-action";
import { ContextMenu, Menu, type MenuEntry } from "@/ui/menu";
import { TabPanel, Tabs } from "@/ui/tabs";
import { Tile } from "@/ui/tile";

import { useCluster } from "./api";
import { usePodForwards, useStopForward } from "./forwards";
import { useKubeSheet } from "./kube-sheet";
import { KubeSheets } from "./kube-sheets";
import { podMenu, podTileState } from "./pod-actions";
import { PodEvents } from "./pod-events";
import { PodLogs } from "./pod-logs";
import { PodTerminal } from "./pod-terminal";
import { PodYaml } from "./pod-yaml";

const route = getRouteApi("/kubernetes/pods/$namespace/$name");

type PodTab = "logs" | "terminal" | "events" | "yaml";

const POD_TABS: { value: PodTab; label: string }[] = [
  { value: "logs", label: "Logs" },
  { value: "terminal", label: "Terminal" },
  { value: "events", label: "Events" },
  { value: "yaml", label: "YAML" },
];

const asPodTab = (value: string | undefined): PodTab =>
  POD_TABS.find((tab) => tab.value === value)?.value ?? "logs";

/** Running forwards to this pod, each with its own stop button. */
function Forwards({ pod }: { pod: PodSummary }) {
  const forwards = usePodForwards(pod);
  const stop = useStopForward();
  return forwards.map((forward) => {
    const address = `localhost:${forward.localPort}`;
    const menu: MenuEntry[] = [
      {
        label: "Open in Browser",
        onSelect: () => openUrl(`http://${address}`).catch(() => undefined),
      },
      { kind: "separator" },
      { label: "Copy Address", onSelect: () => copyText("Address", address) },
      { kind: "separator" },
      { label: "Stop Forwarding", onSelect: () => stop.mutate(forward.stream) },
    ];
    return (
      <ContextMenu key={forward.stream} entries={menu}>
        <span className="inline-flex items-center gap-1 text-12 text-ink-2">
          <code className="font-mono text-mono-12">
            {address} → {forward.podPort}
          </code>
          <IconAction
            label="Stop forwarding"
            target={address}
            onClick={() => stop.mutate(forward.stream)}
          >
            <IconX />
          </IconAction>
        </span>
      </ContextMenu>
    );
  });
}

function PodHeader({
  pod,
  onForward,
  menu,
}: {
  pod: PodSummary;
  onForward: () => void;
  menu: MenuEntry[];
}) {
  return (
    <header className="flex items-center gap-3.5 px-5 pt-[18px] pb-3.5">
      <Tile icon="pod" size="lg" state={podTileState(pod)} />
      <div className="min-w-0 flex-1">
        <h1 className="m-0 truncate text-20 font-semibold tracking-[-0.012em] text-ink">
          {pod.name}
        </h1>
        <p className="m-0 mt-0.5 flex flex-wrap items-center gap-x-3.5 text-12 text-ink-3">
          <Chip>{pod.namespace}</Chip>
          <span className={pod.problem ? "text-bad-ink" : undefined}>
            {pod.status} · {plural(pod.restarts, "restart")}
          </span>
          <span>Up {formatAge(pod.createdAt)}</span>
          {pod.node ? <span>Node {pod.node}</span> : null}
          {pod.ip ? <code className="font-mono text-mono-12">{pod.ip}</code> : null}
        </p>
      </div>
      <Forwards pod={pod} />
      <Button onClick={onForward}>
        <IconArrowsExchange />
        Port forward
      </Button>
      <Menu entries={menu} align="end">
        <Button variant="ghost" iconOnly aria-label={`More for ${pod.name}`}>
          <IconDots />
        </Button>
      </Menu>
    </header>
  );
}

function PodView({ cluster, pod }: { cluster: Cluster; pod: PodSummary }) {
  const { tab } = route.useSearch();
  const navigate = useNavigate();
  const { sheet, open, close } = useKubeSheet();
  const container = pod.containers.length > 1 ? (pod.containers[0] ?? null) : null;
  const show = (next: PodTab) => navigate({ to: ".", search: { tab: next } });
  const menu: MenuEntry[] = [
    { label: "Terminal", disabled: pod.status !== "Running", onSelect: () => show("terminal") },
    ...podMenu(pod, open),
  ];
  return (
    <>
      <PodHeader pod={pod} onForward={() => open({ kind: "forward", pod })} menu={menu} />
      <Tabs tabs={POD_TABS} value={asPodTab(tab)} onChange={show}>
        <TabPanel value="logs">
          <PodLogs pod={pod} container={container} />
        </TabPanel>
        <TabPanel value="terminal">
          <PodTerminal pod={pod} />
        </TabPanel>
        <TabPanel value="events" className="overflow-auto">
          <PodEvents pod={pod} />
        </TabPanel>
        <TabPanel value="yaml">
          <PodYaml pod={pod} onEdit={(manifest) => open({ kind: "apply", manifest })} />
        </TabPanel>
      </Tabs>
      <KubeSheets sheet={sheet} cluster={cluster} onClose={close} />
    </>
  );
}

export function PodPage() {
  const { namespace, name } = route.useParams();
  const { data: cluster } = useCluster();
  const pod = cluster?.pods.find(
    (candidate) => candidate.namespace === namespace && candidate.name === name,
  );
  const crumbs = (
    <>
      <ParentCrumb to="/kubernetes" label="Kubernetes" />
      <Crumb>{name}</Crumb>
    </>
  );
  return (
    <Page crumbs={crumbs} flush>
      {cluster && pod ? <PodView cluster={cluster} pod={pod} /> : null}
      {cluster && !pod ? (
        <EmptyState title={`${name} is gone`} className="h-full">
          Pods are replaced when they restart or scale. Find its successor in the pod list.
        </EmptyState>
      ) : null}
    </Page>
  );
}
