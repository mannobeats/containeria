import { IconDeviceLaptop } from "@tabler/icons-react";

import { formatMemory, plural } from "@/lib/format";
import type { EngineConfig } from "@/lib/ipc/bindings";
import { Slider } from "@/ui/slider";
import { Switch } from "@/ui/switch";

import { useHost } from "./api";
import { EngineChanges } from "./engine-changes";
import { SettingsRow, SettingsSection } from "./settings-section";
import { useEngineDraft } from "./use-engine-draft";

const GIB = 1024 ** 3;

type Edit = { config: EngineConfig; update: (patch: Partial<EngineConfig>) => void };

function Resources({ config, update, savedDisk }: Edit & { savedDisk: number }) {
  const { data: host } = useHost();
  const cores = host?.cores ?? Math.max(config.cpus, 8);
  const memory = host ? Math.floor(host.memoryBytes / GIB) : Math.max(config.memoryGib, 16);
  return (
    <>
      {host ? (
        <p className="m-0 mb-3.5 flex items-center gap-2 text-13 text-ink-3">
          <IconDeviceLaptop aria-hidden />
          <span>
            This Mac: <b className="font-medium text-ink">{host.chip}</b>,{" "}
            {plural(host.cores, "core")}, {formatMemory(host.memoryBytes)} memory
          </span>
        </p>
      ) : null}
      <SettingsSection title="Resources">
        <SettingsRow block label="CPUs" hint="Containers share them. Idle cores cost nothing.">
          <Slider
            label="CPUs"
            value={config.cpus}
            min={1}
            max={cores}
            format={(count) => plural(count, "core")}
            onChange={(cpus) => update({ cpus })}
          />
        </SettingsRow>
        <SettingsRow
          block
          label="Memory limit"
          hint="The most the engine may use. It takes what its containers need, not this much."
        >
          <Slider
            label="Memory limit"
            value={config.memoryGib}
            min={2}
            max={memory}
            format={(gib) => `${gib} GB`}
            onChange={(memoryGib) => update({ memoryGib })}
          />
        </SettingsRow>
        <SettingsRow block label="Disk size" hint="The disk can grow but never shrink.">
          <Slider
            label="Disk size"
            value={config.diskGib}
            min={savedDisk}
            max={Math.max(512, savedDisk)}
            step={8}
            format={(gib) => `${gib} GB`}
            onChange={(diskGib) => update({ diskGib })}
          />
        </SettingsRow>
      </SettingsSection>
    </>
  );
}

function VirtualMachine({ config, update }: Edit) {
  const toggle = (
    label: string,
    key: "rosetta" | "sleepWhenIdle" | "setDockerContext",
    hint: string,
  ) => (
    <SettingsRow label={label} hint={hint}>
      <Switch label={label} checked={config[key]} onCheckedChange={(on) => update({ [key]: on })} />
    </SettingsRow>
  );
  return (
    <SettingsSection title="Virtual machine">
      {toggle(
        "Run Intel images with Rosetta",
        "rosetta",
        "linux/amd64 images run at near-native speed.",
      )}
      {toggle(
        "Sleep when nothing runs",
        "sleepWhenIdle",
        "Turns the VM off a minute after the last container stops, giving all its memory back. The next docker command, or opening this window, starts it again in about a second.",
      )}
      {toggle(
        "Make docker use Containeria",
        "setDockerContext",
        "Switches the docker CLI's context to this engine when it starts.",
      )}
    </SettingsSection>
  );
}

export function EnginePane() {
  const { config, update, status } = useEngineDraft();
  if (!(config && status)) {
    return null;
  }
  return (
    <>
      <Resources config={config} update={update} savedDisk={status.config.diskGib} />
      <VirtualMachine config={config} update={update} />
      <EngineChanges />
    </>
  );
}
