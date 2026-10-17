import { IconDots, IconRotateClockwise, IconScale } from "@tabler/icons-react";
import clsx from "clsx";

import { copyText } from "@/lib/clipboard";
import { formatAge } from "@/lib/format";
import { commands, type DeploymentSummary } from "@/lib/ipc/bindings";
import { Button } from "@/ui/button";
import { Chip } from "@/ui/chip";
import { type Column, ColumnTable } from "@/ui/column-table";
import { IconAction } from "@/ui/icon-action";
import { Menu, type MenuEntry } from "@/ui/menu";
import { Meter } from "@/ui/progress";
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

type Handlers = { open: Open; restart: (deployment: DeploymentSummary) => void };

function deploymentMenu(deployment: DeploymentSummary, { open, restart }: Handlers): MenuEntry[] {
  return [
    { label: "Scale…", onSelect: () => open({ kind: "scale", deployment }) },
    { label: "Restart Rollout", onSelect: () => restart(deployment) },
    { kind: "separator" },
    { label: "Copy Name", onSelect: () => copyText("Name", deployment.name) },
    { kind: "separator" },
    {
      label: "Delete Deployment…",
      danger: true,
      onSelect: () => open({ kind: "deleteDeployment", deployment }),
    },
  ];
}

function Actions({ deployment, handlers }: { deployment: DeploymentSummary; handlers: Handlers }) {
  return (
    <span className="inline-flex gap-0.5 opacity-0 transition-opacity duration-140 group-focus-within/row:opacity-100 group-hover/row:opacity-100">
      <IconAction
        label="Scale"
        target={deployment.name}
        onClick={() => handlers.open({ kind: "scale", deployment })}
      >
        <IconScale />
      </IconAction>
      <IconAction
        label="Rollout restart"
        target={deployment.name}
        onClick={() => handlers.restart(deployment)}
      >
        <IconRotateClockwise />
      </IconAction>
      <Menu entries={deploymentMenu(deployment, handlers)} align="end">
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
  const restart = useKubeAction(
    (deployment: DeploymentSummary) =>
      commands.kubernetesRestartDeployment(deployment.namespace, deployment.name),
    (deployment) => `Restarting ${deployment.name}`,
  );
  const handlers: Handlers = { open, restart: (deployment) => restart.mutate(deployment) };
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
      cell: (deployment) => <Actions deployment={deployment} handlers={handlers} />,
    },
  ];
  return (
    <ColumnTable
      label="Deployments"
      columns={columns}
      rows={deployments}
      rowKey={(deployment) => `${deployment.namespace}/${deployment.name}`}
      menu={(deployment) => deploymentMenu(deployment, handlers)}
    />
  );
}
