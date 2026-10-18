import { useRef, useState } from "react";

import { newDraft } from "@/features/compose/model";
import { useCompose } from "@/features/compose/store";
import { usageById, useMetrics } from "@/features/metrics/api";
import type { ContainerAction, ContainerSummary } from "@/lib/ipc/bindings";
import { useIdSet } from "@/lib/use-id-set";
import { useSelection, useSelectionKeys } from "@/lib/use-selection";
import { useSlashToSearch } from "@/lib/use-slash-to-search";
import { Crumb, Page } from "@/shell/page";
import { Button } from "@/ui/button";
import { EmptyState } from "@/ui/empty-state";
import { SearchField } from "@/ui/search-field";
import { Segmented } from "@/ui/segmented";
import { Tile } from "@/ui/tile";
import { useContainerAction, useContainers } from "./api";
import { BulkBar } from "./bulk-bar";
import { ContainerTable } from "./container-table";
import { ContainersHero } from "./containers-hero";
import { CrashBanners } from "./crash-banners";
import { DeleteSheet } from "./delete-sheet";
import {
  type ContainerGroup,
  emptyTitle,
  type Filter,
  filterOptions,
  groupByProject,
  matches,
} from "./model";
import { useRunSheet } from "./run/api";

function NoContainers() {
  const showRunSheet = useRunSheet((state) => state.show);
  const edit = useCompose((state) => state.edit);
  return (
    <EmptyState
      art={<Tile icon="container" size="xl" />}
      title="No containers yet"
      className="h-full"
      actions={
        <>
          <Button onClick={() => edit(newDraft())}>Deploy Compose</Button>
          <Button variant="brand" onClick={() => showRunSheet()}>
            Run container
          </Button>
        </>
      }
    >
      Run one, deploy a Compose project or drop a compose.yaml here. Containers started with{" "}
      <code className="font-mono text-mono-13">docker run</code> show up at once.
    </EmptyState>
  );
}

type ToolbarProps = {
  containers: ContainerSummary[];
  filter: Filter;
  onFilter: (filter: Filter) => void;
  query: string;
  onQuery: (query: string) => void;
};

function Toolbar({ containers, filter, onFilter, query, onQuery }: ToolbarProps) {
  const search = useRef<HTMLInputElement>(null);
  useSlashToSearch(search);
  return (
    <div className="flex items-center gap-2 px-5 pt-1 pb-3">
      <Segmented
        label="Show"
        value={filter}
        onChange={onFilter}
        options={filterOptions(containers)}
      />
      <SearchField
        ref={search}
        value={query}
        onChange={onQuery}
        placeholder="Filter containers"
        shortcut="/"
        className="w-[220px]"
      />
    </div>
  );
}

/** Containers the list shows: Kubernetes pods live under Kubernetes instead. */
function useListedContainers() {
  const { data } = useContainers();
  return data?.filter((container) => container.pod === null);
}

/** The rows in the order they show, so ⇧-click selects what lies between. */
function useContainerSelection(
  groups: ContainerGroup[],
  all: ContainerSummary[],
  onDelete: (containers: ContainerSummary[]) => void,
) {
  const selection = useSelection(
    groups.flatMap((group) => group.containers.map((container) => container.id)),
  );
  const chosen = all.filter((container) => selection.has(container.id));
  useSelectionKeys(selection, () => onDelete(chosen));
  return { selection, chosen };
}

export function ContainersPage() {
  const containers = useListedContainers();
  const { data: metrics } = useMetrics();
  const action = useContainerAction();
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [hot, setHot] = useState<string | null>(null);
  const [removing, setRemoving] = useState<ContainerSummary[]>([]);
  const collapsed = useIdSet();
  const all = containers ?? [];
  const visible = all.filter((container) => matches(container, filter, query));
  const groups = groupByProject(visible);
  const { selection, chosen } = useContainerSelection(groups, all, setRemoving);
  if (containers?.length === 0) {
    return (
      <Page crumbs={<Crumb>Containers</Crumb>}>
        <NoContainers />
      </Page>
    );
  }
  const act = (targets: ContainerSummary[], verb: ContainerAction, label?: string) =>
    action.mutate({ containers: targets, action: verb, ...(label ? { label } : {}) });
  const finish = (targets: ContainerSummary[], verb: ContainerAction) => {
    act(targets, verb);
    selection.clear();
    setRemoving([]);
  };
  return (
    <Page crumbs={<Crumb>Containers</Crumb>}>
      <ContainersHero containers={containers} ledger={metrics?.ledger} hot={hot} onHot={setHot} />
      <CrashBanners containers={all} />
      <Toolbar
        containers={all}
        filter={filter}
        onFilter={setFilter}
        query={query}
        onQuery={setQuery}
      />
      <div className="pb-[72px]">
        {containers && visible.length === 0 ? (
          <EmptyState
            title={emptyTitle(filter, query)}
            actions={query ? <Button onClick={() => setQuery("")}>Clear search</Button> : null}
          />
        ) : (
          <ContainerTable
            groups={groups}
            usage={usageById(metrics)}
            selected={new Set(selection.chosen)}
            onSelect={selection.set}
            onPick={selection.click}
            collapsed={collapsed.ids}
            onCollapse={collapsed.toggle}
            act={act}
            remove={setRemoving}
          />
        )}
      </div>
      <BulkBar
        count={chosen.length}
        onAct={(verb) => finish(chosen, verb)}
        onRemove={() => setRemoving(chosen)}
        onClear={selection.clear}
      />
      <DeleteSheet
        containers={removing}
        onCancel={() => setRemoving([])}
        onConfirm={() => finish(removing, "remove")}
      />
    </Page>
  );
}
