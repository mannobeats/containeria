import {
  IconDots,
  IconFolder,
  IconPlayerPlay,
  IconPlayerStop,
  IconTerminal2,
} from "@tabler/icons-react";
import { Link, useNavigate } from "@tanstack/react-router";
import clsx from "clsx";

import { formatMemory, formatPercent } from "@/lib/format";
import type { MachineAction } from "@/lib/ipc/bindings";
import { logoFor } from "@/lib/logos";
import { Button } from "@/ui/button";
import { ContextMenu, Menu } from "@/ui/menu";
import { Tile } from "@/ui/tile";

import { machineMenu } from "./machine-menu";
import { isRunning, kindLabel, type ListedMachine, stateLabel } from "./model";

type MachineCardProps = {
  machine: ListedMachine;
  act: (name: string, action: MachineAction) => void;
  remove: () => void;
};

function Details({ machine }: { machine: ListedMachine }) {
  const running = isRunning(machine);
  return (
    <dl
      className={clsx(
        "m-0 grid grid-cols-[60px_minmax(0,1fr)] gap-x-3 gap-y-[5px] text-12",
        "[&_dt]:text-ink-3 [&_dd]:m-0 [&_dd]:min-w-0 [&_dd]:truncate",
        running ? "[&_dd]:text-ink" : "[&_dd]:text-ink-3",
      )}
    >
      <dt>State</dt>
      <dd>{stateLabel(machine)}</dd>
      <dt>Kind</dt>
      <dd>{kindLabel(machine)}</dd>
      <dt>IP</dt>
      <dd className="font-mono text-mono-12 select-text">{machine.ipv4 ?? "—"}</dd>
      {running ? (
        <>
          <dt>Usage</dt>
          <dd className="tabular">
            {formatPercent(machine.cpuPercent)} CPU · {formatMemory(machine.memoryBytes)}
          </dd>
        </>
      ) : null}
    </dl>
  );
}

/** One machine as an object you can pick up: who it is, how it's doing, the next thing to do. */
export function MachineCard({ machine, act, remove }: MachineCardProps) {
  const navigate = useNavigate();
  const running = isRunning(machine);
  const open = (tab?: string) =>
    navigate({ to: "/machines/$name", params: { name: machine.name }, search: tab ? { tab } : {} });
  const menu = machineMenu(machine, { open, act: (action) => act(machine.name, action), remove });
  return (
    <ContextMenu entries={menu}>
      <article className="relative flex flex-col gap-3.5 rounded-lg bg-surface p-3.5 shadow-1 transition-shadow duration-220 hover:shadow-2">
        <div className="flex items-center gap-2.5">
          <Tile
            logo={logoFor(machine.distro)}
            icon="machine"
            size="lg"
            state={running ? "on" : "off"}
          />
          <Link
            to="/machines/$name"
            params={{ name: machine.name }}
            className="flex min-w-0 flex-1 flex-col gap-px text-inherit no-underline outline-none after:absolute after:inset-0 after:rounded-lg focus-visible:after:shadow-focus"
          >
            <b className="truncate text-14 font-semibold text-ink">{machine.name}</b>
            <span className="truncate text-12 text-ink-3">
              {machine.distro} {machine.release}
            </span>
          </Link>
          <Menu entries={menu} align="end">
            <Button
              variant="ghost"
              size="sm"
              iconOnly
              aria-label={`More for ${machine.name}`}
              className="relative z-[1] text-ink-3"
            >
              <IconDots />
            </Button>
          </Menu>
        </div>
        <Details machine={machine} />
        <div className="relative z-[1] mt-auto flex items-center gap-2">
          {running ? (
            <>
              <Button size="sm" onClick={() => open("terminal")}>
                <IconTerminal2 />
                Terminal
              </Button>
              <Button size="sm" onClick={() => open("files")}>
                <IconFolder />
                Files
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto"
                onClick={() => act(machine.name, "stop")}
              >
                <IconPlayerStop />
                Stop
              </Button>
            </>
          ) : (
            <Button size="sm" onClick={() => act(machine.name, "start")}>
              <IconPlayerPlay />
              Start
            </Button>
          )}
        </div>
      </article>
    </ContextMenu>
  );
}
