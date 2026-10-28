import { IconCopy } from "@tabler/icons-react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import clsx from "clsx";
import { useId } from "react";
import { toast } from "sonner";

import { Button } from "@/ui/button";
import { inputClass } from "@/ui/input-class";

import { EngineChanges } from "./engine-changes";
import { linesOf } from "./model";
import { SettingsRow, SettingsSection } from "./settings-section";
import { useEngineDraft } from "./use-engine-draft";

type ListFieldProps = {
  label: string;
  hint: string;
  placeholder: string;
  value: string[];
  onChange: (value: string[]) => void;
};

function ListField({ label, hint, placeholder, value, onChange }: ListFieldProps) {
  const id = useId();
  return (
    <SettingsRow block label={<label htmlFor={id}>{label}</label>} hint={hint}>
      <textarea
        key={value.join("\n")}
        id={id}
        rows={3}
        spellCheck={false}
        placeholder={placeholder}
        defaultValue={value.join("\n")}
        onBlur={(event) => onChange(linesOf(event.target.value))}
        className={clsx(
          inputClass,
          "h-auto min-h-[72px] resize-y py-[7px] font-mono text-mono-13 leading-normal",
        )}
      />
    </SettingsRow>
  );
}

export function DockerPane() {
  const { config, update, status } = useEngineDraft();
  if (!(config && status)) {
    return null;
  }
  const copy = () =>
    writeText(status.dockerSocket)
      .then(() => toast("Copied", { description: status.dockerSocket }))
      .catch(() => undefined);
  return (
    <>
      <SettingsSection title="Registries" note="One per line. Written to the engine's daemon.json.">
        <ListField
          label="Registry mirrors"
          hint="Docker Hub pulls go through these first."
          placeholder="https://mirror.gcr.io"
          value={config.registryMirrors}
          onChange={(registryMirrors) => update({ registryMirrors })}
        />
        <ListField
          label="Insecure registries"
          hint="Registries Docker may reach over plain HTTP, like a local registry."
          placeholder="localhost:5000"
          value={config.insecureRegistries}
          onChange={(insecureRegistries) => update({ insecureRegistries })}
        />
      </SettingsSection>
      <SettingsSection title="Socket">
        <SettingsRow
          label="Docker socket"
          hint={<span className="font-mono text-mono-12 select-text">{status.dockerSocket}</span>}
        >
          <Button size="sm" onClick={copy}>
            <IconCopy />
            Copy path
          </Button>
        </SettingsRow>
      </SettingsSection>
      <EngineChanges />
    </>
  );
}
