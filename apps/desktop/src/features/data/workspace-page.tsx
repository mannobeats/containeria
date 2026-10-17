import { IconAlertCircle, IconRefresh } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { getRouteApi, Link } from "@tanstack/react-router";
import type { Namespace, ServerInfo } from "@/lib/ipc/bindings";
import { errorMessage } from "@/lib/ipc/errors";
import { Crumb, Page } from "@/shell/page";
import { ParentCrumb } from "@/shell/parent-crumb";
import { Button } from "@/ui/button";
import { buttonClass } from "@/ui/button-class";
import { EmptyState } from "@/ui/empty-state";
import { Skeleton } from "@/ui/progress";
import { Tile } from "@/ui/tile";

import { dataKeys, useSchema, useSession } from "./api";
import { DiagramView } from "./diagram/diagram-view";
import { HistoryView } from "./history-view";
import { findTable, tableKey } from "./model";
import { QueryView } from "./query/query-view";
import { RedisView } from "./redis/redis-view";
import { SafeBanner } from "./safe-banner";
import { SchemaTree } from "./schema-tree";
import { TableActionSheets } from "./table/table-action-sheets";
import { TableView } from "./table/table-view";
import { tabFromKey } from "./tabs";
import { type Tab, useWorkspace } from "./workspace-store";
import { WorkspaceTabs } from "./workspace-tabs";

const route = getRouteApi("/data/$connection");

function Connecting() {
  return (
    <div className="grid min-h-0 flex-1 grid-cols-[244px_minmax(0,1fr)]">
      <div className="flex flex-col gap-2.5 border-r-[0.5px] border-line bg-panel-solid p-4">
        {[60, 82, 54, 70, 46, 78].map((width) => (
          <Skeleton key={width} className="h-3" />
        ))}
      </div>
      <div className="flex flex-col gap-3 p-5">
        {[90, 70, 84, 62].map((width) => (
          <Skeleton key={width} className="h-3.5" />
        ))}
      </div>
    </div>
  );
}

function CouldNotConnect({ id, error }: { id: string; error: unknown }) {
  const client = useQueryClient();
  return (
    <EmptyState
      art={<Tile icon="data" size="xl" state="bad" />}
      title="Couldn't connect"
      className="h-full"
      actions={
        <>
          <Button
            variant="brand"
            onClick={() => client.resetQueries({ queryKey: dataKeys.session(id) })}
          >
            <IconRefresh />
            Try again
          </Button>
          <Link to="/data" className={buttonClass()}>
            All connections
          </Link>
        </>
      }
    >
      <pre className="m-0 max-w-[520px] rounded-md bg-bad-soft px-3 py-2.5 text-left font-mono text-mono-12 whitespace-pre-wrap text-bad-ink select-text">
        <IconAlertCircle className="mr-1.5 inline size-3.5 align-[-2px]" aria-hidden />
        {errorMessage(error)}
      </pre>
    </EmptyState>
  );
}

/** The tab to show when the URL names none: the key browser, or the first table. */
function defaultTab(info: ServerInfo, namespaces: Namespace[] | undefined): Tab | undefined {
  if (info.capabilities.keys) {
    return tabFromKey("keys");
  }
  const first = namespaces?.flatMap((namespace) => namespace.tables)[0];
  return first ? tabFromKey(`table:${tableKey(first)}`) : undefined;
}

function ActiveView({
  info,
  tab,
  namespaces,
}: {
  info: ServerInfo;
  tab: Tab | undefined;
  namespaces: Namespace[];
}) {
  switch (tab?.kind) {
    case "table": {
      const table = findTable(namespaces, tab.key.slice(6));
      return table ? (
        <TableView info={info} table={table} />
      ) : (
        <EmptyState title={`There's no table named ${tab.title}`}>
          Refresh the schema to check.
        </EmptyState>
      );
    }
    case "query":
      return <QueryView info={info} tabKey={tab.key} namespaces={namespaces} />;
    case "diagram":
      return <DiagramView info={info} namespaces={namespaces} />;
    case "history":
      return <HistoryView info={info} />;
    case "keys":
      return <RedisView info={info} />;
    default:
      return (
        <EmptyState title="Nothing open">
          Choose a table on the left, or start a new query.
        </EmptyState>
      );
  }
}

function Workspace({ info, tabKey }: { info: ServerInfo; tabKey: string | undefined }) {
  const { data: namespaces = [] } = useSchema(info.id, info.capabilities.tables);
  const stored = useWorkspace((state) => state.tabs[info.id]) ?? [];
  const active = (tabKey ? tabFromKey(tabKey) : undefined) ?? defaultTab(info, namespaces);
  const tabs =
    active && !stored.some((tab) => tab.key === active.key) ? [...stored, active] : stored;
  return (
    <div
      className={
        info.capabilities.tables
          ? "grid min-h-0 flex-1 grid-cols-[244px_minmax(0,1fr)]"
          : "flex min-h-0 flex-1"
      }
    >
      {info.capabilities.tables ? (
        <SchemaTree info={info} namespaces={namespaces} active={active?.key} />
      ) : null}
      <section className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        <WorkspaceTabs info={info} tabs={tabs} active={active?.key} />
        <SafeBanner info={info} />
        <ActiveView info={info} tab={active} namespaces={namespaces} />
      </section>
      <TableActionSheets info={info} />
    </div>
  );
}

/** One connection: schema on the left, tabs of tables and queries on the right. */
export function WorkspacePage() {
  const { connection } = route.useParams();
  const { tab } = route.useSearch();
  const session = useSession(connection);
  return (
    <Page
      flush
      crumbs={
        <>
          <ParentCrumb to="/data" label="Data" />
          <Crumb>{session.data?.name ?? connection.replace(/^container:/, "")}</Crumb>
        </>
      }
    >
      {session.isPending ? <Connecting /> : null}
      {session.isError ? <CouldNotConnect id={connection} error={session.error} /> : null}
      {session.data ? <Workspace info={session.data} tabKey={tab} /> : null}
    </Page>
  );
}
