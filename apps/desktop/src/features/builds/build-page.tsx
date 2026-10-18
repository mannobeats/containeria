import { IconAlertCircle, IconDots } from "@tabler/icons-react";
import { getRouteApi, Link, useNavigate } from "@tanstack/react-router";

import { formatRelative } from "@/lib/format";
import type { BuildError, BuildRecord } from "@/lib/ipc/bindings";
import { isCommandError } from "@/lib/ipc/errors";
import { useNow } from "@/lib/use-now";
import { Crumb, Page } from "@/shell/page";
import { ParentCrumb } from "@/shell/parent-crumb";
import { Banner } from "@/ui/banner";
import { Button } from "@/ui/button";
import { buttonClass } from "@/ui/button-class";
import { EmptyState } from "@/ui/empty-state";
import { LogView } from "@/ui/log-view";
import { Menu } from "@/ui/menu";
import { Progress, Skeleton } from "@/ui/progress";
import { ResourceHeader } from "@/ui/resource-header";
import { TabPanel, Tabs } from "@/ui/tabs";
import { Tile } from "@/ui/tile";

import { useBuild, useBuildLogs, useBuilds, useRemoveBuild } from "./api";
import { BuildInfo } from "./build-info";
import { buildMenu } from "./build-menu";
import { BuildStatusLabel } from "./build-status";
import {
  buildName,
  buildProgress,
  buildTileState,
  cachedLabel,
  elapsed,
  formatDuration,
} from "./model";

const route = getRouteApi("/builds/$id");

const TABS = [
  { value: "logs", label: "Logs" },
  { value: "info", label: "Info" },
] as const;

function BuildLogs({ id, name }: { id: string; name: string }) {
  return <LogView label={`Output of ${name}`} lines={useBuildLogs(id)} />;
}

function Failure({ error }: { error: BuildError }) {
  return (
    <Banner tone="bad" icon={<IconAlertCircle aria-hidden />} className="mx-5 mb-3 items-start">
      <b className="block font-mono text-mono-12">{error.step ?? "The build failed"}</b>
      <span className="block select-text">{error.message}</span>
      {error.logs.length > 0 ? (
        <pre className="m-0 mt-1.5 font-mono text-mono-12 whitespace-pre-wrap select-text">
          {error.logs.join("\n")}
        </pre>
      ) : null}
    </Banner>
  );
}

function Header({ build }: { build: BuildRecord }) {
  const navigate = useNavigate();
  const remove = useRemoveBuild();
  const running = build.status === "running";
  const now = useNow(running);
  const name = buildName(build);
  const menu = buildMenu(build, {
    remove: () =>
      remove.mutate(
        { id: build.id, name },
        { onSuccess: () => navigate({ to: "/builds" }).catch(() => undefined) },
      ),
  });
  return (
    <>
      <ResourceHeader
        face={<Tile icon="build" size="lg" state={buildTileState(build)} />}
        title={name}
        meta={
          <>
            <BuildStatusLabel status={build.status} />
            <span>Started {formatRelative(build.startedAtMs / 1000, now)}</span>
            <span className="tabular">{formatDuration(elapsed(build, now))}</span>
            {cachedLabel(build) ? <span>{cachedLabel(build)}</span> : null}
          </>
        }
        actions={
          <Menu entries={menu} align="end">
            <Button iconOnly aria-label={`More for ${name}`}>
              <IconDots />
            </Button>
          </Menu>
        }
      />
      {running ? (
        <Progress value={buildProgress(build)} label={`${name} progress`} className="mx-5 mb-3" />
      ) : null}
    </>
  );
}

function Gone() {
  return (
    <Page crumbs={<ParentCrumb to="/builds" label="Builds" />}>
      <EmptyState
        art={<Tile icon="build" size="xl" />}
        title="This build isn't in the history"
        className="h-full"
        actions={
          <Link to="/builds" className={buttonClass()}>
            Back to Builds
          </Link>
        }
      >
        It was removed, or the history was cleared.
      </EmptyState>
    </Page>
  );
}

export function BuildPage() {
  const { id } = route.useParams();
  const search = route.useSearch();
  const navigate = route.useNavigate();
  const tab = search.tab === "info" ? "info" : "logs";
  const { data: builds } = useBuilds();
  const { data: detail, error } = useBuild(id);
  const build = builds?.find((candidate) => candidate.id === id);
  if (isCommandError(error) && error.kind === "notFound") {
    return <Gone />;
  }
  const name = build ? buildName(build) : (detail?.name ?? id.slice(0, 7));
  return (
    <Page
      crumbs={
        <>
          <ParentCrumb to="/builds" label="Builds" />
          <Crumb>{name}</Crumb>
        </>
      }
      flush
    >
      {build ? <Header build={build} /> : <Skeleton className="mx-5 my-7 h-8 w-80" />}
      {detail?.error ? <Failure error={detail.error} /> : null}
      <Tabs
        tabs={[...TABS]}
        value={tab}
        onChange={(value) =>
          navigate({
            to: "/builds/$id",
            params: { id },
            search: value === "logs" ? {} : { tab: value },
          })
        }
      >
        <TabPanel value="logs">
          <BuildLogs id={id} name={name} />
        </TabPanel>
        <TabPanel value="info" className="overflow-auto">
          {detail ? <BuildInfo detail={detail} /> : null}
        </TabPanel>
      </Tabs>
    </Page>
  );
}
