import { useState } from "react";

import { useEngineStatus, useSaveEngineConfig } from "@/features/engine/api";
import { useHost } from "@/features/settings/api";
import { SettingsRow, SettingsSection } from "@/features/settings/settings-section";
import { plural } from "@/lib/format";
import type { EngineConfig } from "@/lib/ipc/bindings";
import { Button } from "@/ui/button";
import { Slider } from "@/ui/slider";
import { Switch } from "@/ui/switch";

const GIB = 1024 ** 3;

function ResourcesForm({ initial, onDone }: { initial: EngineConfig; onDone: () => void }) {
  const { data: host } = useHost();
  const save = useSaveEngineConfig();
  const [config, setConfig] = useState(initial);
  const update = (patch: Partial<EngineConfig>) =>
    setConfig((current) => ({ ...current, ...patch }));
  return (
    <>
      <SettingsSection>
        <SettingsRow block label="CPUs" hint="Containers share them. Idle cores cost nothing.">
          <Slider
            label="CPUs"
            value={config.cpus}
            min={1}
            max={host?.cores ?? 8}
            format={(count) => plural(count, "core")}
            onChange={(cpus) => update({ cpus })}
          />
        </SettingsRow>
        <SettingsRow block label="Memory limit" hint="A ceiling, not a reservation.">
          <Slider
            label="Memory limit"
            value={config.memoryGib}
            min={2}
            max={host ? Math.floor(host.memoryBytes / GIB) : 16}
            format={(gib) => `${gib} GB`}
            onChange={(memoryGib) => update({ memoryGib })}
          />
        </SettingsRow>
        <SettingsRow
          label="Run Intel images with Rosetta"
          hint="linux/amd64 images run at near-native speed."
        >
          <Switch
            label="Rosetta"
            checked={config.rosetta}
            onCheckedChange={(rosetta) => update({ rosetta })}
          />
        </SettingsRow>
        <SettingsRow
          label="Make docker use Containeria"
          hint="Switches the docker CLI to this engine. Change it later in Settings."
        >
          <Switch
            label="Make docker use Containeria"
            checked={config.setDockerContext}
            onCheckedChange={(setDockerContext) => update({ setDockerContext })}
          />
        </SettingsRow>
      </SettingsSection>
      <div className="mt-8 flex justify-end">
        <Button
          variant="brand"
          size="lg"
          loading={save.isPending}
          onClick={() => save.mutate(config, { onSuccess: onDone })}
        >
          Continue
        </Button>
      </div>
    </>
  );
}

export function StepResources({ onDone }: { onDone: () => void }) {
  const { data: status } = useEngineStatus();
  return (
    <>
      <h1 className="m-0 text-24 font-semibold tracking-[-0.016em] text-ink">
        How much can the engine use?
      </h1>
      <p className="m-0 mt-2 mb-6 text-14 text-ink-2">
        These are ceilings. The engine starts small and grows only when containers need it.
      </p>
      {status ? <ResourcesForm initial={status.config} onDone={onDone} /> : null}
    </>
  );
}
