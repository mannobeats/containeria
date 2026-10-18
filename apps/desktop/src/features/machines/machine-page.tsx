import { IconDots, IconPlayerPlay, IconPlayerStop } from "@tabler/icons-react";
import { getRouteApi } from "@tanstack/react-router";
import { useState } from "react";

import type { Machine } from "@/lib/ipc/bindings";
import { logoFor } from "@/lib/logos";
import { Crumb, Page } from "@/shell/page";
import { ParentCrumb } from "@/shell/parent-crumb";
import { Button } from "@/ui/button";
import { EmptyState } from "@/ui/empty-state";
import { Menu } from "@/ui/menu";
import { TabPanel, Tabs } from "@/ui/tabs";
import { Tile } from "@/ui/tile";

import { useMachineAction, useMachines, useMachinesStatus } from "./api";
import { MachineDialogs } from "./machine-dialogs";
import { MachineFiles } from "./machine-files";
import { type MachineDialog, machineMenu } from "./machine-menu";
import { MachineOverview } from "./machine-overview";
import { MachineSnapshots } from "./machine-snapshots";
import { MachineTerminal } from "./machine-terminal";
import { MachinesIntro } from "./machines-intro";
import { isRunning, kindLabel, type ListedMachine, stateLabel } from "./model";

const route = getRouteApi("/machines/$name");

type Tab = "overview" | "terminal" | "files" | "snapshots";

const TABS: { value: Tab; label: string }[] = [
  { value: "overview", label: "Overview" },
  { value: "terminal", label: "Terminal" },
  { value: "files", label: "Files" },
  { value: "snapshots", label: "Snapshots" },
];

function Header({
  machine,
  onTab,
  onDialog,
}: {
  machine: ListedMachine;
  onTab: (tab: Tab) => void;
  onDialog: (dialog: MachineDialog) => void;
}) {
  const action = useMachineAction();
  const act = (verb: "start" | "stop" | "restart") =>
    action.mutate({ name: machine.name, action: verb });
  const running = isRunning(machine);
  const menu = machineMenu(machine, {
    open: (tab) => onTab((tab as Tab | undefined) ?? "overview"),
    act,
    dialog: onDialog,
  });
  return (
    <div className="flex shrink-0 items-center gap-3 px-5 pt-[18px] pb-3.5">
      <Tile
        logo={logoFor(machine.distro)}
        icon="machine"
        size="lg"
        state={running ? "on" : "off"}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <h1 className="m-0 truncate text-20 font-semibold tracking-[-0.012em] text-ink select-text">
          {machine.name}
        </h1>
        <p className="m-0 flex flex-wrap gap-x-3.5 text-12 text-ink-3">
          <span>
            {machine.distro} {machine.release}
          </span>
          <span>{kindLabel(machine)}</span>
          <span>{stateLabel(machine)}</span>
          {machine.ipv4 ? (
            <span className="font-mono text-mono-12 select-text">{machine.ipv4}</span>
          ) : null}
        </p>
      </div>
      {running ? (
        <Button onClick={() => act("stop")}>
          <IconPlayerStop />
          Stop
        </Button>
      ) : (
        <Button variant="brand" onClick={() => act("start")}>
          <IconPlayerPlay />
          Start
        </Button>
      )}
      <Menu entries={menu} align="end">
        <Button variant="ghost" iconOnly aria-label={`More for ${machine.name}`}>
          <IconDots />
        </Button>
      </Menu>
    </div>
  );
}

function StoppedPane({ machine, what }: { machine: Machine; what: string }) {
  const action = useMachineAction();
  return (
    <EmptyState
      art={<Tile logo={logoFor(machine.distro)} icon="machine" size="xl" state="off" />}
      title={`${machine.name} is stopped`}
      actions={
        <Button
          variant="brand"
          onClick={() => action.mutate({ name: machine.name, action: "start" })}
        >
          <IconPlayerPlay />
          Start {machine.name}
        </Button>
      }
    >
      Start it to use the {what}.
    </EmptyState>
  );
}

type Navigation = { tab: Tab; onTab: (tab: Tab) => void; onLeave: () => void };

type DetailProps = Navigation & { machine: ListedMachine; taken: string[]; vmRunning: boolean };

function Detail({ machine, taken, vmRunning, tab, onTab: show, onLeave }: DetailProps) {
  const action = useMachineAction();
  const [dialog, setDialog] = useState<MachineDialog | null>(null);
  const running = isRunning(machine);
  return (
    <>
      <Header machine={machine} onTab={show} onDialog={setDialog} />
      <Tabs tabs={TABS} value={tab} onChange={show}>
        <TabPanel value="overview" className="overflow-auto pt-4">
          <MachineOverview
            machine={machine}
            onStart={() => action.mutate({ name: machine.name, action: "start" })}
          />
        </TabPanel>
        <TabPanel value="terminal" className="flex flex-col">
          {running ? (
            <MachineTerminal name={machine.name} />
          ) : (
            <StoppedPane machine={machine} what="terminal" />
          )}
        </TabPanel>
        <TabPanel value="files" className="flex flex-col">
          {running ? (
            <MachineFiles name={machine.name} />
          ) : (
            <StoppedPane machine={machine} what="files" />
          )}
        </TabPanel>
        <TabPanel value="snapshots" className="flex flex-col">
          {vmRunning ? (
            <MachineSnapshots name={machine.name} onTake={() => setDialog("snapshot")} />
          ) : (
            <StoppedPane machine={machine} what="snapshots" />
          )}
        </TabPanel>
      </Tabs>
      <MachineDialogs
        machine={machine}
        dialog={dialog}
        taken={taken}
        onClose={() => setDialog(null)}
        onDeleted={onLeave}
      />
    </>
  );
}

/** One machine: its header, then overview, terminal, files and snapshots tabs. */
export function MachineView({ name, tab, onTab, onLeave }: Navigation & { name: string }) {
  const { data: status } = useMachinesStatus();
  const { data: list } = useMachines();
  const machine = list?.machines.find((candidate) => candidate.name === name);
  const vmShown = status?.phase === "running" || status?.phase === "stopped";
  const crumbs = (
    <>
      <ParentCrumb to="/machines" label="Linux machines" />
      <Crumb>{name}</Crumb>
    </>
  );
  return (
    <Page crumbs={crumbs} flush>
      {status && !vmShown ? <MachinesIntro phase={status.phase} onNew={onLeave} /> : null}
      {machine && vmShown ? (
        <Detail
          machine={machine}
          vmRunning={status?.phase === "running"}
          taken={list?.machines.map((candidate) => candidate.name) ?? []}
          tab={tab}
          onTab={onTab}
          onLeave={onLeave}
        />
      ) : null}
      {list && !machine ? (
        <EmptyState title={`${name} doesn't exist`} className="h-full">
          It may have been deleted.
        </EmptyState>
      ) : null}
    </Page>
  );
}

const isTab = (tab: string | undefined): tab is Tab => TABS.some((known) => known.value === tab);

export function MachinePage() {
  const { name } = route.useParams();
  const { tab } = route.useSearch();
  const navigate = route.useNavigate();
  return (
    <MachineView
      name={name}
      tab={isTab(tab) ? tab : "overview"}
      onTab={(next) =>
        navigate({ to: "/machines/$name", params: { name }, search: { tab: next } }).catch(
          () => undefined,
        )
      }
      onLeave={() => navigate({ to: "/machines" }).catch(() => undefined)}
    />
  );
}
