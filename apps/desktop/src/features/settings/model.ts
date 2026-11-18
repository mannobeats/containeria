import type {
  CliTool,
  EngineConfig,
  EngineStatus,
  NotifyOn,
  Preferences,
} from "@/lib/ipc/bindings";

const GIB = 1024 ** 3;

const listed = new Intl.ListFormat("en", { style: "long", type: "conjunction" });

/** The tools no terminal finds, as a phrase: "docker, kubectl and cx". Empty when none is missing. */
export function missingTools(tools: CliTool[]): string {
  return listed.format(tools.filter((tool) => tool.state === "missing").map((tool) => tool.name));
}

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
  flag("sleep when idle", saved.sleepWhenIdle, draft.sleepWhenIdle);
  flag("Docker context", saved.setDockerContext, draft.setDockerContext);
  flag("Kubernetes", saved.kubernetes.enabled, draft.kubernetes.enabled);
  if (saved.kubernetes.version !== draft.kubernetes.version) {
    changes.push(`Kubernetes ${draft.kubernetes.version}`);
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
  const vm = status?.phase === "running" ? status.vm : null;
  if (!(vm && status)) {
    return false;
  }
  return (
    vm.cpus !== status.config.cpus ||
    Math.round(vm.memory.ceilingBytes / GIB) !== status.config.memoryGib
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
