import { IconChevronDown, IconChevronRight, IconChevronUp } from "@tabler/icons-react";
import { getRouteApi, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useEffectEvent } from "react";

import { isCommandError } from "@/lib/ipc/errors";
import { Crumb, Page } from "@/shell/page";
import { ParentCrumb } from "@/shell/parent-crumb";
import { buttonClass } from "@/ui/button-class";
import { EmptyState } from "@/ui/empty-state";
import { IconAction } from "@/ui/icon-action";
import { Skeleton } from "@/ui/progress";
import { TabPanel, Tabs } from "@/ui/tabs";

import { useContainers } from "./api";
import { useContainerDetails } from "./detail/api";
import { DetailHeader } from "./detail/detail-header";
import { FilesTab } from "./detail/files-tab";
import { InspectTab } from "./detail/inspect-tab";
import { LogsTab } from "./detail/logs-tab";
import { OverviewTab } from "./detail/overview-tab";
import { StatsTab } from "./detail/stats-tab";
import { TerminalTab } from "./detail/terminal-tab";

const route = getRouteApi("/containers/$id");

const TABS = [
  { value: "overview", label: "Overview" },
  { value: "logs", label: "Logs" },
  { value: "terminal", label: "Terminal" },
  { value: "files", label: "Files" },
  { value: "stats", label: "Stats" },
  { value: "inspect", label: "Inspect" },
] as const;

type Tab = (typeof TABS)[number]["value"];

const isTab = (value: string | undefined): value is Tab => TABS.some((tab) => tab.value === value);

/** ⌘[ and ⌘] step through containers in list order, keeping the tab. */
function useNeighbours(id: string, tab: Tab) {
  const { data } = useContainers();
  const navigate = useNavigate();
  const list = data?.filter((container) => container.pod === null) ?? [];
  const index = list.findIndex((container) => container.id === id);
  const previous = index > 0 ? list[index - 1] : undefined;
  const next = index >= 0 ? list[index + 1] : undefined;
  const go = (target: { id: string } | undefined) =>
    target
      ? navigate({
          to: "/containers/$id",
          params: { id: target.id },
          search: tab === "overview" ? {} : { tab },
        })
      : undefined;
  const onKey = useEffectEvent((event: KeyboardEvent) => {
    if (event.metaKey && (event.key === "[" || event.key === "]")) {
      event.preventDefault();
      go(event.key === "[" ? previous : next)?.catch(() => undefined);
    }
  });
  useEffect(() => {
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return { previous, next, go };
}

function Gone() {
  return (
    <Page crumbs={<Crumb>Container</Crumb>}>
      <EmptyState
        title="This container was deleted"
        className="h-full"
        actions={
          <Link to="/containers" className={buttonClass()}>
            Back to containers
          </Link>
        }
      />
    </Page>
  );
}

export function ContainerPage() {
  const { id } = route.useParams();
  const search = route.useSearch();
  const navigate = route.useNavigate();
  const tab: Tab = isTab(search.tab) ? search.tab : "overview";
  const { data: details, error } = useContainerDetails(id);
  const { previous, next, go } = useNeighbours(id, tab);
  if (isCommandError(error) && error.kind === "notFound") {
    return <Gone />;
  }
  const running = details?.state === "running";
  const crumbs = (
    <>
      <ParentCrumb to="/containers" label="Containers" />
      {details?.project ? (
        <>
          <span className="px-1 py-0.5">{details.project}</span>
          <IconChevronRight aria-hidden className="size-3.5 text-ink-4" />
        </>
      ) : null}
      <Crumb>{details?.service ?? details?.name ?? id.slice(0, 12)}</Crumb>
    </>
  );
  const tools = (
    <>
      <IconAction
        label="Previous container"
        kbd="⌘["
        disabled={!previous}
        onClick={() => go(previous)}
      >
        <IconChevronUp />
      </IconAction>
      <IconAction label="Next container" kbd="⌘]" disabled={!next} onClick={() => go(next)}>
        <IconChevronDown />
      </IconAction>
    </>
  );
  return (
    <Page crumbs={crumbs} tools={tools} flush>
      {details ? <DetailHeader details={details} /> : <Skeleton className="mx-5 my-7 h-8 w-80" />}
      <Tabs
        tabs={[...TABS]}
        value={tab}
        onChange={(value) =>
          navigate({
            to: "/containers/$id",
            params: { id },
            search: value === "overview" ? {} : { tab: value },
          })
        }
      >
        <TabPanel value="overview" className="overflow-auto">
          {details ? <OverviewTab details={details} /> : null}
        </TabPanel>
        <TabPanel value="logs">
          <LogsTab id={id} name={details?.name ?? id} />
        </TabPanel>
        <TabPanel value="terminal">
          <TerminalTab id={id} name={details?.name ?? id} running={running} />
        </TabPanel>
        <TabPanel value="files">
          <FilesTab id={id} />
        </TabPanel>
        <TabPanel value="stats">
          <StatsTab id={id} running={running} />
        </TabPanel>
        <TabPanel value="inspect">
          {details ? <InspectTab name={details.name} raw={details.raw} /> : null}
        </TabPanel>
      </Tabs>
    </Page>
  );
}
