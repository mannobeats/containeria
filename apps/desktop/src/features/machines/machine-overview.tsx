import { IconPlayerStop } from "@tabler/icons-react";

import { formatMemory, formatPercent } from "@/lib/format";
import { Banner } from "@/ui/banner";
import { Button } from "@/ui/button";
import { Kv } from "@/ui/kv";

import { isRunning, kindLabel, type ListedMachine, limitLabel, stateLabel } from "./model";

type OverviewProps = { machine: ListedMachine; onStart: () => void };

/** What the machine is, where it lives and what it uses. */
export function MachineOverview({ machine, onStart }: OverviewProps) {
  const running = isRunning(machine);
  return (
    <div className="grid max-w-[1100px] grid-cols-[minmax(0,1fr)_minmax(300px,380px)] items-start gap-8 px-5 pt-1.5 pb-10 max-[1180px]:grid-cols-1">
      <section className="flex flex-col gap-6">
        {running ? (
          <Kv
            rows={[
              {
                label: "CPU",
                value: <span className="tabular">{formatPercent(machine.cpuPercent)}</span>,
              },
              {
                label: "Memory",
                value: <span className="tabular">{formatMemory(machine.memoryBytes)}</span>,
              },
              { label: "Processes", value: <span className="tabular">{machine.processes}</span> },
            ]}
          />
        ) : (
          <Banner
            icon={<IconPlayerStop aria-hidden />}
            action={
              <Button size="sm" onClick={onStart}>
                Start
              </Button>
            }
          >
            Stopped. It uses no CPU or memory until you start it.
          </Banner>
        )}
      </section>
      <aside>
        <h2 className="m-0 mb-2 text-13 font-semibold text-ink">Details</h2>
        <Kv
          rows={[
            { label: "Distribution", value: `${machine.distro} ${machine.release}` },
            { label: "Kind", value: kindLabel(machine) },
            { label: "State", value: stateLabel(machine) },
            {
              label: "IP address",
              value: (
                <code className="font-mono text-mono-12 select-text">
                  {machine.ipv4 ?? "None yet"}
                </code>
              ),
            },
            {
              label: "Limits",
              value: `${machine.cpuLimit ?? "All"} CPUs · ${limitLabel(machine.memoryLimit) ?? "no memory limit"}`,
            },
            {
              label: "Mac home",
              value: (
                <code className="font-mono text-mono-12">{machine.home ?? "Not mounted"}</code>
              ),
            },
          ]}
        />
      </aside>
    </div>
  );
}
