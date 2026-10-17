import { IconDots, IconFileUpload } from "@tabler/icons-react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { toast } from "sonner";

import { useContainers } from "@/features/containers/api";
import { useMetrics } from "@/features/metrics/api";
import { formatMemory, plural } from "@/lib/format";
import type { Cluster } from "@/lib/ipc/bindings";
import { Button } from "@/ui/button";
import { Menu } from "@/ui/menu";
import { Switch } from "@/ui/switch";
import { Tile } from "@/ui/tile";

import type { KubeSheet } from "./kube-sheet";
import { k3sVersion, podMemory } from "./model";

const CONTEXT = "colima-containeria";

function copyContext() {
  const command = `kubectl config use-context ${CONTEXT}`;
  writeText(command)
    .then(() => toast("Copied", { description: command }))
    .catch(() => undefined);
}

export function ClusterHeader({
  cluster,
  open,
}: {
  cluster: Cluster;
  open: (sheet: KubeSheet) => void;
}) {
  const { data: containers } = useContainers();
  const { data: metrics } = useMetrics();
  const memory = [...podMemory(containers, metrics).values()].reduce(
    (total, bytes) => total + bytes,
    0,
  );
  return (
    <header className="flex items-center gap-3.5 px-5 pt-[18px] pb-3">
      <Tile icon="kube" size="lg" />
      <div className="min-w-0 flex-1">
        <h1 className="m-0 text-20 font-semibold tracking-[-0.012em] text-ink">Kubernetes</h1>
        <p className="m-0 mt-0.5 flex flex-wrap gap-x-3.5 text-12 text-ink-3">
          <span>k3s {k3sVersion(cluster.version)}</span>
          <span>
            Context <code className="font-mono text-mono-12">{CONTEXT}</code>
          </span>
          <span>{plural(cluster.pods.length, "pod")}</span>
          {memory > 0 ? <span className="tabular">{formatMemory(memory)}</span> : null}
        </p>
      </div>
      <span className="flex items-center gap-2 text-12 text-ink-3">
        Running
        <Switch checked onCheckedChange={() => open({ kind: "turnOff" })} label="Kubernetes" />
      </span>
      <Button variant="brand" onClick={() => open({ kind: "apply" })}>
        <IconFileUpload />
        Apply YAML
      </Button>
      <Menu
        align="end"
        entries={[
          { label: "Copy kubectl context command", onSelect: copyContext },
          { kind: "separator" },
          { label: "Reset cluster…", danger: true, onSelect: () => open({ kind: "reset" }) },
        ]}
      >
        <Button variant="ghost" iconOnly aria-label="Cluster">
          <IconDots />
        </Button>
      </Menu>
    </header>
  );
}
