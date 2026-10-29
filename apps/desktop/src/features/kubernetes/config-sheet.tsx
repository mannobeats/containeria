import { IconCopy, IconEye, IconEyeOff } from "@tabler/icons-react";
import { useState } from "react";

import type { ConfigSummary } from "@/lib/ipc/bindings";
import { errorMessage } from "@/lib/ipc/errors";
import { IconAction } from "@/ui/icon-action";
import { Kv } from "@/ui/kv";
import { Sheet } from "@/ui/sheet";

import { useConfigValue } from "./api";

function Shown({ value }: { value: ReturnType<typeof useConfigValue>["value"] }) {
  if (value.error) {
    return <span className="text-bad-ink">{errorMessage(value.error)}</span>;
  }
  return value.data ?? "…";
}

/** One key's value, read only when shown or copied. Secrets start hidden; config maps don't. */
function Value({ config, name }: { config: ConfigSummary; name: string }) {
  const secret = config.kind === "secret";
  const [shown, setShown] = useState(!secret);
  const { value, copy } = useConfigValue(config, name, shown);
  return (
    <>
      <code className="min-w-0 flex-1 truncate font-mono text-mono-12">
        {shown ? <Shown value={value} /> : "••••••••••••"}
      </code>
      {secret ? (
        <IconAction
          label={shown ? "Hide" : "Reveal"}
          target={name}
          onClick={() => setShown(!shown)}
        >
          {shown ? <IconEyeOff /> : <IconEye />}
        </IconAction>
      ) : null}
      <IconAction label="Copy value" target={name} onClick={copy}>
        <IconCopy />
      </IconAction>
    </>
  );
}

/** The keys of a config map or secret, with their values on request. */
export function ConfigSheet({ config, onClose }: { config: ConfigSummary; onClose: () => void }) {
  return (
    <Sheet
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={config.name}
      description={`${config.kind === "secret" ? "Secret" : "Config map"} in ${config.namespace}`}
    >
      <Kv
        rows={config.keys.map((key) => ({
          label: key,
          value: <Value config={config} name={key} />,
        }))}
      />
    </Sheet>
  );
}
