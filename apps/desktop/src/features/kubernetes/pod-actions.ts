import { copyText } from "@/lib/clipboard";
import type { PodSummary } from "@/lib/ipc/bindings";
import type { MenuEntry } from "@/ui/menu";

import type { KubeSheet } from "./kube-sheet";

/** The same menu on a pod's row and on its own page. */
export function podMenu(pod: PodSummary, open: (sheet: KubeSheet) => void): MenuEntry[] {
  const { ip } = pod;
  return [
    { label: "Port Forward…", onSelect: () => open({ kind: "forward", pod }) },
    { kind: "separator" },
    { label: "Copy Name", onSelect: () => copyText("Name", pod.name) },
    ...(ip ? [{ label: "Copy IP", onSelect: () => copyText("IP", ip) }] : []),
    { kind: "separator" },
    { label: "Delete Pod…", danger: true, onSelect: () => open({ kind: "deletePod", pod }) },
  ];
}

export function podTileState(pod: PodSummary): "on" | "off" | "bad" {
  if (pod.problem) {
    return "bad";
  }
  return pod.status === "Completed" ? "off" : "on";
}
