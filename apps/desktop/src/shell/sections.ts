import type { CxIconName } from "@/ui/cx-icon";

export type Section = {
  to:
    | "/containers"
    | "/images"
    | "/builds"
    | "/volumes"
    | "/networks"
    | "/kubernetes"
    | "/machines"
    | "/data"
    | "/domains"
    | "/activity";
  label: string;
  icon: CxIconName;
  shortcut?: string;
};

/** The sidebar's order. */
export const SECTIONS: Section[] = [
  { to: "/containers", label: "Containers", icon: "container", shortcut: "⌘1" },
  { to: "/images", label: "Images", icon: "image", shortcut: "⌘2" },
  { to: "/builds", label: "Builds", icon: "build" },
  { to: "/volumes", label: "Volumes", icon: "volume", shortcut: "⌘3" },
  { to: "/networks", label: "Networks", icon: "network", shortcut: "⌘4" },
  { to: "/kubernetes", label: "Kubernetes", icon: "kube", shortcut: "⌘5" },
  { to: "/machines", label: "Linux machines", icon: "machine", shortcut: "⌘6" },
  { to: "/data", label: "Data", icon: "data" },
  { to: "/domains", label: "Domains", icon: "domain" },
  { to: "/activity", label: "Activity", icon: "activity" },
];
