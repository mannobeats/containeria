import { writeText } from "@tauri-apps/plugin-clipboard-manager";

import type { PodSummary } from "@/lib/ipc/bindings";
import type { MenuEntry } from "@/ui/menu";

import type { KubeSheet } from "./kube-sheet";

/** The same menu on a pod's row and on its own page. */
export function podMenu(pod: PodSummary, open: (sheet: KubeSheet) => void): MenuEntry[] {
  return [
    { label: "Port forward…", onSelect: () => open({ kind: "forward", pod }) },
    { label: "Copy name", onSelect: () => writeText(pod.name).catch(() => undefined) },
    { kind: "separator" },
    { label: "Delete pod…", danger: true, onSelect: () => open({ kind: "deletePod", pod }) },
  ];
}

export function podTileState(pod: PodSummary): "on" | "off" | "bad" {
  if (pod.problem) {
    return "bad";
  }
  return pod.status === "Completed" ? "off" : "on";
}
