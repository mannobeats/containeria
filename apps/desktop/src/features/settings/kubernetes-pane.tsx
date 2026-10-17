import { Input } from "@/ui/field";
import { Switch } from "@/ui/switch";

import { EngineChanges } from "./engine-changes";
import { SettingsRow, SettingsSection } from "./settings-section";
import { useEngineDraft } from "./use-engine-draft";

export function KubernetesPane() {
  const { config, update } = useEngineDraft();
  if (!config) {
    return null;
  }
  return (
    <>
      <SettingsSection note="k3s runs inside the engine and uses Docker as its runtime, so images you build are ready for pods without a registry.">
        <SettingsRow
          label="Kubernetes"
          hint="A single-node k3s cluster. kubectl gets a context for it."
        >
          <Switch
            label="Kubernetes"
            checked={config.kubernetes.enabled}
            onCheckedChange={(enabled) => update({ kubernetes: { ...config.kubernetes, enabled } })}
          />
        </SettingsRow>
        <SettingsRow label="Version" hint="An exact k3s release, such as v1.35.0+k3s1.">
          <Input
            aria-label="Kubernetes version"
            value={config.kubernetes.version}
            onChange={(event) =>
              update({ kubernetes: { ...config.kubernetes, version: event.target.value.trim() } })
            }
            className="w-[180px] font-mono text-mono-13"
            spellCheck={false}
          />
        </SettingsRow>
      </SettingsSection>
      <EngineChanges />
    </>
  );
}
