import { useState } from "react";

import type { ConfigSummary, DeploymentSummary, PodSummary } from "@/lib/ipc/bindings";

export type KubeSheet =
  | { kind: "apply"; manifest?: string }
  | { kind: "scale"; deployment: DeploymentSummary }
  | { kind: "forward"; pod: PodSummary }
  | { kind: "config"; config: ConfigSummary }
  | { kind: "deletePod"; pod: PodSummary }
  | { kind: "deleteDeployment"; deployment: DeploymentSummary }
  | { kind: "turnOff" }
  | { kind: "reset" };

/** The sheet a Kubernetes view has open, if any. */
export function useKubeSheet() {
  const [sheet, setSheet] = useState<KubeSheet | null>(null);
  return { sheet, open: setSheet, close: () => setSheet(null) };
}
