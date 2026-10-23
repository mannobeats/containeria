import type { ContainerAction, ContainerSummary } from "@/lib/ipc/bindings";

/** What a row or a project header can ask the page to do. */
export type ContainerCallbacks = {
  act: (containers: ContainerSummary[], action: ContainerAction, label?: string) => void;
  remove: (containers: ContainerSummary[]) => void;
};
