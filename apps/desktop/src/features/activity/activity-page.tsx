import { IconAdjustments } from "@tabler/icons-react";

import { useContainers } from "@/features/containers/api";
import { isServing, useEngineStatus } from "@/features/engine/api";
import { useMetrics } from "@/features/metrics/api";
import { commands } from "@/lib/ipc/bindings";
import { Crumb, Page } from "@/shell/page";
import { Button } from "@/ui/button";
import { EmptyState } from "@/ui/empty-state";
import { Tile } from "@/ui/tile";
import { Tip } from "@/ui/tooltip";

import { ActivityHero } from "./activity-hero";
import { useMetricsHistory } from "./api";
import { EngineCharts } from "./engine-charts";
import { topConsumers } from "./model";
import { TopConsumers } from "./top-consumers";

const tools = (
  <Tip label="Engine settings">
    <Button
      variant="ghost"
      iconOnly
      aria-label="Engine settings"
      onClick={() => commands.settingsOpen("engine").catch(() => undefined)}
    >
      <IconAdjustments />
    </Button>
  </Tip>
);

export function ActivityPage() {
  const { data: status } = useEngineStatus();
  const { data: metrics } = useMetrics();
  const { data: history } = useMetricsHistory();
  const { data: containers } = useContainers();
  if (status && !isServing(status.phase)) {
    return (
      <Page crumbs={<Crumb>Activity</Crumb>} tools={tools}>
        <EmptyState
          art={<Tile icon="activity" size="xl" />}
          title="Nothing to measure yet"
          className="h-full"
        >
          Activity shows the engine's CPU and memory while it runs.
        </EmptyState>
      </Page>
    );
  }
  return (
    <Page crumbs={<Crumb>Activity</Crumb>} tools={tools}>
      <ActivityHero ledger={metrics?.ledger} status={status} />
      <EngineCharts
        points={history ?? []}
        cpus={status?.config.cpus ?? 1}
        totalBytes={metrics?.ledger.totalBytes ?? 0}
      />
      <TopConsumers consumers={topConsumers(metrics, containers ?? [])} />
    </Page>
  );
}
