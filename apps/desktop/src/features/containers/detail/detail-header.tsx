import {
  IconAlertCircle,
  IconAlertTriangle,
  IconExternalLink,
  IconPlayerPlay,
  IconPlayerStop,
  IconRefresh,
} from "@tabler/icons-react";
import { Link } from "@tanstack/react-router";
import { openUrl } from "@tauri-apps/plugin-opener";

import { formatRelative } from "@/lib/format";
import type { ContainerDetails } from "@/lib/ipc/bindings";
import { logoFor } from "@/lib/logos";
import { Button } from "@/ui/button";
import { buttonClass } from "@/ui/button-class";
import { Chip } from "@/ui/chip";
import { CxIcon } from "@/ui/cx-icon";
import { IconAction } from "@/ui/icon-action";
import { Tile } from "@/ui/tile";

import { useContainerAction } from "../api";
import { isErrorExit } from "../model";
import { DetailMenu } from "./detail-menu";
import { isDatabase } from "./detail-model";

const crashed = (details: ContainerDetails) =>
  details.state === "exited" && isErrorExit(details.exitCode);

function tileState(details: ContainerDetails): "on" | "off" | "bad" {
  if (crashed(details)) {
    return "bad";
  }
  return details.state === "running" ? "on" : "off";
}

const since = (timestamp: string | null) =>
  timestamp ? formatRelative(Date.parse(timestamp) / 1000) : "";

function StateChip({ details }: { details: ContainerDetails }) {
  if (details.health?.status === "unhealthy") {
    return (
      <Chip tone="warn">
        <IconAlertTriangle aria-hidden />
        Unhealthy
      </Chip>
    );
  }
  if (crashed(details)) {
    return (
      <Chip tone="bad">
        <IconAlertCircle aria-hidden />
        Exited ({details.exitCode})
      </Chip>
    );
  }
  return details.state === "paused" ? <Chip>Paused</Chip> : null;
}

function Subtitle({ details }: { details: ContainerDetails }) {
  const started = details.state === "running" || details.state === "paused";
  return (
    <div className="mt-[3px] flex flex-wrap items-center gap-x-3.5 gap-y-1 text-12 text-ink-3">
      <span className="font-mono text-mono-12">{details.image}</span>
      <span>
        {details.project ? `${details.project} · ${details.service ?? details.name}` : "Standalone"}
      </span>
      <span>
        {started ? `Started ${since(details.startedAt)}` : `Exited ${since(details.finishedAt)}`}
      </span>
    </div>
  );
}

/** Name, state and the actions people reach for most: start or stop, restart, open. */
export function DetailHeader({ details }: { details: ContainerDetails }) {
  const action = useContainerAction();
  const running = details.state === "running";
  const paused = details.state === "paused";
  const target = [{ id: details.id, name: details.name }];
  const port = details.ports.find((candidate) => candidate.host !== null);
  return (
    <div className="flex items-center gap-3.5 px-5 pt-[18px] pb-3.5">
      <Tile logo={logoFor(details.image)} size="xl" state={tileState(details)} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <h1 className="m-0 max-w-[420px] truncate text-20 font-semibold tracking-[-0.012em] text-ink">
            {details.name}
          </h1>
          <StateChip details={details} />
        </div>
        <Subtitle details={details} />
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {isDatabase(details) ? (
          <Link to="/data" className={buttonClass()}>
            <CxIcon name="data" />
            Open in Data
          </Link>
        ) : null}
        {running && port?.host ? (
          <Button onClick={() => openUrl(`http://localhost:${port.host}`).catch(() => undefined)}>
            <IconExternalLink />
            Open
          </Button>
        ) : null}
        <IconAction
          label="Restart"
          target={details.name}
          onClick={() => action.mutate({ containers: target, action: "restart" })}
        >
          <IconRefresh />
        </IconAction>
        {running ? (
          <Button onClick={() => action.mutate({ containers: target, action: "stop" })}>
            <IconPlayerStop />
            Stop
          </Button>
        ) : (
          <Button
            variant="brand"
            onClick={() =>
              action.mutate({ containers: target, action: paused ? "resume" : "start" })
            }
          >
            <IconPlayerPlay />
            {paused ? "Resume" : "Start"}
          </Button>
        )}
        <DetailMenu details={details} />
      </div>
    </div>
  );
}
