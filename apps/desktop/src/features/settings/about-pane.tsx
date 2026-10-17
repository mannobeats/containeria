import { IconBrandGithub } from "@tabler/icons-react";
import { openUrl } from "@tauri-apps/plugin-opener";

import { collectDiagnostics } from "@/lib/diagnostics";
import { AppMark } from "@/ui/app-mark";
import { Button } from "@/ui/button";
import { Kv } from "@/ui/kv";

import { useAbout } from "./api";
import { SettingsSection } from "./settings-section";

const SOURCE = "https://github.com/mannobeats/containeria";

const BUILT_ON: [string, string][] = [
  ["Colima", "MIT"],
  ["Lima", "Apache-2.0"],
  ["Docker Engine (Moby)", "Apache-2.0"],
  ["k3s", "Apache-2.0"],
  ["Tauri", "MIT / Apache-2.0"],
  ["Geist and Geist Mono", "OFL-1.1"],
  ["Tabler Icons", "MIT"],
  ["uPlot", "MIT"],
];

const notRunning = <span className="text-ink-3">Engine not running</span>;

export function AboutPane() {
  const { data: about } = useAbout();
  const engine = about?.engine;
  return (
    <>
      <div className="flex flex-col items-center gap-2 pt-2 pb-6 text-center">
        <AppMark size={72} />
        <h2 className="m-0 mt-1.5 text-24 font-semibold tracking-[-0.016em] text-ink">
          Containeria
        </h2>
        <p className="m-0 text-12 text-ink-3">
          Version {about?.appVersion ?? "…"} · Free and open source under Apache-2.0
        </p>
        <span className="mt-1 flex gap-2">
          <Button size="sm" onClick={() => openUrl(SOURCE).catch(() => undefined)}>
            <IconBrandGithub />
            Source code ↗
          </Button>
          <Button size="sm" onClick={collectDiagnostics}>
            Collect Diagnostics…
          </Button>
        </span>
      </div>
      <SettingsSection title="Engine">
        <Kv
          className="px-3.5 py-0.5"
          rows={[
            {
              label: "Colima",
              value: about?.colimaVersion ?? <span className="text-ink-3">Not found</span>,
            },
            { label: "Docker Engine", value: engine ? engine.serverVersion : notRunning },
            {
              label: "Kernel",
              value: engine ? (
                <span className="font-mono text-mono-12">{engine.kernelVersion}</span>
              ) : (
                notRunning
              ),
            },
            { label: "Operating system", value: engine ? engine.operatingSystem : notRunning },
          ]}
        />
      </SettingsSection>
      <SettingsSection title="Built on">
        <Kv
          className="px-3.5 py-0.5"
          rows={BUILT_ON.map(([name, license]) => ({
            label: name,
            value: <span className="text-ink-3">{license}</span>,
          }))}
        />
      </SettingsSection>
    </>
  );
}
