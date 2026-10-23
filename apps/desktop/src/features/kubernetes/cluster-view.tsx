import { IconAlertTriangle, IconBox, IconSelector } from "@tabler/icons-react";
import { Link } from "@tanstack/react-router";
import { useState } from "react";

import type { Cluster } from "@/lib/ipc/bindings";
import { Banner } from "@/ui/banner";
import { Button } from "@/ui/button";
import { buttonClass } from "@/ui/button-class";
import { EmptyState } from "@/ui/empty-state";
import { Menu, type MenuEntry } from "@/ui/menu";
import { SearchField } from "@/ui/search-field";
import { TabPanel, Tabs } from "@/ui/tabs";

import { ClusterHeader } from "./cluster-header";
import { ConfigTable } from "./config-table";
import { DeploymentsTable } from "./deployments-table";
import { type KubeSheet, useKubeSheet } from "./kube-sheet";
import { KubeSheets } from "./kube-sheets";
import { crashing, type Namespace, sortPods, TABS, type Tab, tabCounts, visible } from "./model";
import { IngressTable, ServicesTable } from "./network-tables";
import { PodsTable } from "./pods-table";

function CrashBanner({ cluster }: { cluster: Cluster }) {
  const pod = crashing(cluster)[0];
  if (!pod) {
    return null;
  }
  return (
    <Banner
      tone="bad"
      icon={<IconAlertTriangle aria-hidden />}
      className="mx-5 mb-3.5"
      action={
        <Link
          to="/kubernetes/pods/$namespace/$name"
          params={{ namespace: pod.namespace, name: pod.name }}
          search={{ tab: "logs" }}
          className={buttonClass({ size: "sm" })}
        >
          View logs
        </Link>
      }
    >
      <b>{pod.name}</b> is failing in {pod.namespace}: {pod.problem}, {pod.restarts} restarts.
    </Banner>
  );
}

function NamespaceMenu({
  cluster,
  value,
  onChange,
  open,
}: {
  cluster: Cluster;
  value: Namespace;
  onChange: (namespace: Namespace) => void;
  open: (sheet: KubeSheet) => void;
}) {
  const entries: MenuEntry[] = [
    { kind: "label", label: "Namespace" },
    { label: "All Namespaces", checked: value === null, onSelect: () => onChange(null) },
    { kind: "separator" },
    ...cluster.namespaces.map((namespace) => ({
      label: namespace,
      checked: value === namespace,
      onSelect: () => onChange(namespace),
    })),
    { kind: "separator" },
    { label: "New Namespace…", onSelect: () => open({ kind: "newNamespace" }) },
  ];
  return (
    <Menu entries={entries}>
      <Button>
        <IconBox />
        {value ?? "All namespaces"}
        <IconSelector className="text-ink-3" />
      </Button>
    </Menu>
  );
}

type Filters = { namespace: Namespace; query: string };

function Panels({
  cluster,
  filters,
  open,
}: {
  cluster: Cluster;
  filters: Filters;
  open: (sheet: KubeSheet) => void;
}) {
  const { namespace, query } = filters;
  return (
    <>
      <TabPanel value="pods">
        <PodsTable
          pods={sortPods(visible(cluster.pods, namespace, query, (pod) => [pod.status]))}
          open={open}
        />
      </TabPanel>
      <TabPanel value="deployments">
        <DeploymentsTable
          deployments={visible(cluster.deployments, namespace, query, (item) => item.images)}
          open={open}
        />
      </TabPanel>
      <TabPanel value="services">
        <ServicesTable
          services={visible(cluster.services, namespace, query, (item) => [item.kind])}
        />
      </TabPanel>
      <TabPanel value="ingress">
        <IngressTable
          ingresses={visible(cluster.ingresses, namespace, query, (item) =>
            item.routes.map((route) => route.host),
          )}
        />
      </TabPanel>
      <TabPanel value="config">
        <ConfigTable
          config={visible(cluster.config, namespace, query, (item) => item.keys)}
          open={open}
        />
      </TabPanel>
    </>
  );
}

type ClusterViewProps = { cluster: Cluster; tab: Tab; onTab: (tab: Tab) => void };

export function ClusterView({ cluster, tab, onTab }: ClusterViewProps) {
  const [namespace, setNamespace] = useState<Namespace>(null);
  const [query, setQuery] = useState("");
  const { sheet, open, close } = useKubeSheet();
  const counts = tabCounts(cluster, namespace);
  return (
    <>
      <ClusterHeader cluster={cluster} open={open} />
      <CrashBanner cluster={cluster} />
      <Tabs
        tabs={TABS.map((item) => ({ ...item, count: counts[item.value] }))}
        value={tab}
        onChange={onTab}
      >
        <div className="flex items-center gap-2 px-5 pt-3 pb-3">
          <NamespaceMenu cluster={cluster} value={namespace} onChange={setNamespace} open={open} />
          <SearchField
            value={query}
            onChange={setQuery}
            placeholder="Filter"
            className="w-[220px]"
          />
        </div>
        {counts[tab] === 0 ? (
          <EmptyState title={namespace ? `Nothing here in ${namespace}` : "Nothing here yet"}>
            Apply a manifest, or switch namespace.
          </EmptyState>
        ) : (
          <Panels cluster={cluster} filters={{ namespace, query }} open={open} />
        )}
      </Tabs>
      <KubeSheets sheet={sheet} cluster={cluster} onClose={close} />
    </>
  );
}
