import type { EngineConfig, EngineStatus, NotifyOn, Preferences } from "@/lib/ipc/bindings";

const GIB = 1024 ** 3;

const onOff = (on: boolean) => (on ? "on" : "off");

const sameList = (a: string[], b: string[]) =>
  a.length === b.length && a.every((item, index) => item === b[index]);

/** What a saved draft changes, in words: "CPUs 4 → 6", "Rosetta off". */
export function describeChanges(saved: EngineConfig, draft: EngineConfig): string[] {
  const changes: string[] = [];
  const number = (label: string, from: number, to: number, unit = "") => {
    if (from !== to) {
      changes.push(`${label} ${from} → ${to}${unit}`);
    }
  };
  const flag = (label: string, from: boolean, to: boolean) => {
    if (from !== to) {
      changes.push(`${label} ${onOff(to)}`);
    }
  };
  number("CPUs", saved.cpus, draft.cpus);
  number("memory", saved.memoryGib, draft.memoryGib, " GB");
  number("disk", saved.diskGib, draft.diskGib, " GB");
  flag("Rosetta", saved.rosetta, draft.rosetta);
  flag("file-watch events", saved.fileWatchEvents, draft.fileWatchEvents);
  flag("SSH agent", saved.forwardSshAgent, draft.forwardSshAgent);
  flag("UDP ports", saved.udpPorts, draft.udpPorts);
  flag("container IP access", saved.containerIpAccess, draft.containerIpAccess);
  flag("Docker context", saved.setDockerContext, draft.setDockerContext);
  flag("Kubernetes", saved.kubernetes.enabled, draft.kubernetes.enabled);
  if (saved.kubernetes.version !== draft.kubernetes.version) {
    changes.push(`Kubernetes ${draft.kubernetes.version}`);
  }
  if (saved.vmType !== draft.vmType) {
    changes.push(`virtualization ${draft.vmType === "vz" ? "Apple Virtualization" : "krunkit"}`);
  }
  if (
    !(
      sameList(saved.registryMirrors, draft.registryMirrors) &&
      sameList(saved.insecureRegistries, draft.insecureRegistries)
    )
  ) {
    changes.push("registries");
  }
  return changes;
}

/** True when the running engine's size doesn't match its saved settings yet. */
export function sizeOutOfDate(status: EngineStatus | undefined): boolean {
  const instance = status?.phase === "running" ? status.instance : null;
  if (!instance) {
    return false;
  }
  return (
    instance.cpus !== status?.config.cpus ||
    Math.round(instance.memoryBytes / GIB) !== status.config.memoryGib
  );
}

/** One entry per non-empty line, trimmed: how registry lists are typed. */
export function linesOf(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/** Preferences with one kind of notification switched on or off. */
export function withNotification(
  preferences: Preferences,
  kind: NotifyOn,
  on: boolean,
): Preferences {
  if (preferences.notifyOn.includes(kind) === on) {
    return preferences;
  }
  const notifyOn = on
    ? [...preferences.notifyOn, kind]
    : preferences.notifyOn.filter((other) => other !== kind);
  return { ...preferences, notifyOn };
}
