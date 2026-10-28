import { IconCopy } from "@tabler/icons-react";
import { useState } from "react";

import { copyText } from "@/lib/clipboard";
import { connectShell, type TerminalStatus } from "@/lib/ipc/connect-shell";
import { Crumb, Page } from "@/shell/page";
import { Button } from "@/ui/button";
import { TerminalStatusLine } from "@/ui/terminal-status";
import { TerminalView } from "@/ui/terminal-view";

import { engineShell } from "./api";

function EngineTerminal({ onReconnect }: { onReconnect: () => void }) {
  const [status, setStatus] = useState<TerminalStatus>({ state: "connecting" });
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-11 shrink-0 items-center gap-3 border-b-[0.5px] border-line pr-3 pl-5">
        <span className="text-12 text-ink-3">
          Root in the engine's Linux VM: Docker, containerd and k3s run here.
        </span>
        <Button
          size="sm"
          className="ml-auto"
          onClick={() =>
            copyText("Command", "COLIMA_HOME=~/.containeria/colima colima ssh -p containeria")
          }
        >
          <IconCopy />
          Copy command
        </Button>
      </div>
      <TerminalStatusLine status={status} onReconnect={onReconnect} />
      <TerminalView
        label="Engine shell"
        connect={(terminal) => connectShell(terminal, engineShell, setStatus)}
      />
    </div>
  );
}

/** A terminal in the VM itself, for what `colima ssh` is used for. */
export function EngineShellPage() {
  const [session, setSession] = useState(0);
  return (
    <Page crumbs={<Crumb>Engine shell</Crumb>}>
      <EngineTerminal key={session} onReconnect={() => setSession(session + 1)} />
    </Page>
  );
}
