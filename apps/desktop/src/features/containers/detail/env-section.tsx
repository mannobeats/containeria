import { IconCopy, IconEye, IconEyeOff } from "@tabler/icons-react";
import { useState } from "react";

import { copyText } from "@/lib/clipboard";
import { plural } from "@/lib/format";
import type { EnvVar } from "@/lib/ipc/bindings";
import { Button } from "@/ui/button";
import { IconAction } from "@/ui/icon-action";

import { isSecret } from "./detail-model";
import { miniTable } from "./mini-table";
import { Section } from "./overview-sections";

/** Environment variables, with anything that looks like a credential hidden until asked. */
export function EnvSection({ env }: { env: EnvVar[] }) {
  const [revealed, setRevealed] = useState(false);
  const hasSecrets = env.some(isSecret);
  return (
    <Section
      title="Environment"
      aside={
        <>
          <span className="text-12 text-ink-3">{plural(env.length, "variable")}</span>
          {hasSecrets ? (
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto"
              onClick={() => setRevealed(!revealed)}
              aria-pressed={revealed}
            >
              {revealed ? <IconEyeOff /> : <IconEye />}
              {revealed ? "Hide values" : "Reveal values"}
            </Button>
          ) : null}
        </>
      }
    >
      <table className={miniTable}>
        <tbody>
          {env.map((variable) => (
            <tr key={variable.key}>
              <td className="w-[38%] max-w-0 truncate font-mono text-mono-12 text-ink">
                {variable.key}
              </td>
              <td className="max-w-0 truncate font-mono text-mono-12 selectable">
                {isSecret(variable) && !revealed ? "••••••••••••" : variable.value}
              </td>
              <td className="w-10 text-right">
                <IconAction
                  label="Copy"
                  target={variable.key}
                  onClick={() => copyText(variable.key, `${variable.key}=${variable.value}`)}
                >
                  <IconCopy />
                </IconAction>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}
