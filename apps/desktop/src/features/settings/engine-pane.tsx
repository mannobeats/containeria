import { IconDeviceLaptop } from "@tabler/icons-react";

import { formatMemory, plural } from "@/lib/format";
import type { EngineConfig, VmType } from "@/lib/ipc/bindings";
import { Select } from "@/ui/select";
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
          hint="A ceiling the engine can grow to, not memory it takes up front."
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

const VM_TYPES: { value: VmType; label: string }[] = [
  { value: "vz", label: "Apple Virtualization" },
  { value: "krunkit", label: "krunkit (libkrun)" },
];

const vmHint = (created: boolean) =>
  `Apple Virtualization keeps Rosetta but holds on to memory it has used until the engine restarts. krunkit gives freed memory back to macOS within seconds, has no Rosetta and is still experimental.${created ? " Chosen when the engine was created; changing it means creating the engine again." : ""}`;

function VirtualMachine({ config, update, created }: Edit & { created: boolean }) {
  const toggle = (
    label: string,
    key:
      | "fileWatchEvents"
      | "forwardSshAgent"
      | "udpPorts"
      | "containerIpAccess"
      | "setDockerContext",
    hint: string,
  ) => (
    <SettingsRow label={label} hint={hint}>
      <Switch label={label} checked={config[key]} onCheckedChange={(on) => update({ [key]: on })} />
    </SettingsRow>
  );
  return (
    <SettingsSection title="Virtual machine">
      <SettingsRow label="Virtualization" hint={vmHint(created)}>
        <Select
          label="Virtualization"
          value={config.vmType}
          options={VM_TYPES}
          disabled={created}
          onChange={(vmType) => update({ vmType })}
          className="w-[200px]"
        />
      </SettingsRow>
      <SettingsRow
        label="Run Intel images with Rosetta"
        hint="linux/amd64 images run at near-native speed. Apple Virtualization only."
      >
        <Switch
          label="Rosetta"
          checked={config.rosetta && config.vmType === "vz"}
          disabled={config.vmType !== "vz"}
          onCheckedChange={(rosetta) => update({ rosetta })}
        />
      </SettingsRow>
      {toggle(
        "File-watch events",
        "fileWatchEvents",
        "Hot reload sees changes made on your Mac. Experimental in Colima.",
      )}
      {toggle(
        "Forward your SSH agent",
        "forwardSshAgent",
        "Containers can use your SSH keys without copying them.",
      )}
      {toggle(
        "UDP ports",
        "udpPorts",
        "Forward published UDP ports too. Uses Colima's experimental port forwarder.",
      )}
      {toggle(
        "Reach containers by IP from the Mac",
        "containerIpAccess",
        "Gives the engine its own address. Asks for your password once.",
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
      <VirtualMachine config={config} update={update} created={status.instance !== null} />
      <EngineChanges />
    </>
  );
}
