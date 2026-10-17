import { IconCopy, IconEye, IconEyeOff } from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { useState } from "react";
import { toast } from "sonner";

import { queryKeys } from "@/app/query-keys";
import { type ConfigSummary, commands } from "@/lib/ipc/bindings";
import { errorMessage } from "@/lib/ipc/errors";
import { IconAction } from "@/ui/icon-action";
import { Kv } from "@/ui/kv";
import { Sheet } from "@/ui/sheet";

function valueQuery(config: ConfigSummary, key: string) {
  return {
    queryKey: [...queryKeys.kubernetes, "value", config.kind, config.namespace, config.name, key],
    queryFn: () => commands.kubernetesConfigValue(config.kind, config.namespace, config.name, key),
    staleTime: Number.POSITIVE_INFINITY,
  };
}

/** One key's value, read only when shown or copied. Secrets start hidden; config maps don't. */
function Value({ config, name }: { config: ConfigSummary; name: string }) {
  const client = useQueryClient();
  const secret = config.kind === "secret";
  const [shown, setShown] = useState(!secret);
  const value = useQuery({ ...valueQuery(config, name), enabled: shown });
  const copy = () =>
    client
      .fetchQuery(valueQuery(config, name))
      .then((text) => writeText(text))
      .then(() => toast("Copied", { description: name }))
      .catch((error: unknown) =>
        toast.error("The value couldn't be read", { description: errorMessage(error) }),
      );
  return (
    <>
      <code className="min-w-0 flex-1 truncate font-mono text-mono-12">
        {shown ? (value.data ?? "…") : "••••••••••••"}
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
