import { IconDots, IconRotateClockwise, IconScale } from "@tabler/icons-react";
import clsx from "clsx";

import { formatAge } from "@/lib/format";
import { commands, type DeploymentSummary } from "@/lib/ipc/bindings";
import { Button } from "@/ui/button";
import { Chip } from "@/ui/chip";
import { IconAction } from "@/ui/icon-action";
import { Menu } from "@/ui/menu";
import { Meter } from "@/ui/progress";
import { type Column, Table } from "@/ui/table";
import { Tile } from "@/ui/tile";

import { useKubeAction } from "./api";
import type { KubeSheet } from "./kube-sheet";

type Open = (sheet: KubeSheet) => void;

const behind = (deployment: DeploymentSummary) => deployment.ready < deployment.desired;

function Ready({ deployment }: { deployment: DeploymentSummary }) {
  return (
    <span className="flex items-center gap-2">
      <Meter
        value={deployment.desired ? deployment.ready / deployment.desired : 0}
        tone={behind(deployment) ? "bad" : "neutral"}
      />
      <span className={clsx("tabular", behind(deployment) && "text-bad-ink")}>
        {deployment.ready}/{deployment.desired}
      </span>
    </span>
  );
}

function Actions({ deployment, open }: { deployment: DeploymentSummary; open: Open }) {
  const restart = useKubeAction(
    () => commands.kubernetesRestartDeployment(deployment.namespace, deployment.name),
    () => `Restarting ${deployment.name}`,
  );
  return (
    <span className="inline-flex gap-0.5 opacity-0 transition-opacity duration-140 group-focus-within/row:opacity-100 group-hover/row:opacity-100">
      <IconAction
        label="Scale"
        target={deployment.name}
        onClick={() => open({ kind: "scale", deployment })}
      >
        <IconScale />
      </IconAction>
      <IconAction
        label="Rollout restart"
        target={deployment.name}
        onClick={() => restart.mutate(undefined)}
      >
        <IconRotateClockwise />
      </IconAction>
      <Menu
        entries={[
          {
            label: "Delete deployment…",
            danger: true,
            onSelect: () => open({ kind: "deleteDeployment", deployment }),
          },
        ]}
        align="end"
      >
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          aria-label={`More for ${deployment.name}`}
          className="text-ink-3 hover:text-ink"
        >
          <IconDots />
        </Button>
      </Menu>
    </span>
  );
}

export function DeploymentsTable({
  deployments,
  open,
}: {
  deployments: DeploymentSummary[];
  open: Open;
}) {
  const columns: Column<DeploymentSummary>[] = [
    {
      header: "Name",
      cell: (deployment) => (
        <span className="flex min-w-0 items-center gap-2">
          <Tile icon="image" state={behind(deployment) ? "bad" : "on"} />
          <span className="truncate font-medium text-ink">{deployment.name}</span>
        </span>
      ),
    },
    {
      header: "Namespace",
      width: "w-[140px]",
      cell: (deployment) => <Chip>{deployment.namespace}</Chip>,
    },
    {
      header: "Ready",
      width: "w-[120px]",
      cell: (deployment) => <Ready deployment={deployment} />,
    },
    {
      header: "Up to date",
      width: "w-[88px]",
      align: "right",
      cell: (deployment) => deployment.upToDate,
    },
    {
      header: "Available",
      width: "w-[80px]",
      align: "right",
      cell: (deployment) => deployment.available,
    },
    {
      header: "Image",
      cell: (deployment) => (
        <code className="font-mono text-mono-12 text-ink-3">{deployment.images.join(", ")}</code>
      ),
    },
    {
      header: "Age",
      width: "w-[60px]",
      align: "right",
      cell: (deployment) => <span className="text-ink-3">{formatAge(deployment.createdAt)}</span>,
    },
    {
      header: "Actions",
      hiddenHeader: true,
      width: "w-[112px]",
      align: "right",
      cell: (deployment) => <Actions deployment={deployment} open={open} />,
    },
  ];
  return (
    <Table
      label="Deployments"
      columns={columns}
      rows={deployments}
      rowKey={(deployment) => `${deployment.namespace}/${deployment.name}`}
    />
  );
}
