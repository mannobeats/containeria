import { useState } from "react";

import { connectShell, type TerminalStatus } from "@/lib/ipc/connect-shell";
import { TerminalStatusLine } from "@/ui/terminal-status";
import { TerminalView } from "@/ui/terminal-view";

import { machineShell } from "./api";

/** A login shell in the machine as its user, sized to the pane. */
export function MachineTerminal({ name }: { name: string }) {
  const [session, setSession] = useState(0);
  const [status, setStatus] = useState<TerminalStatus>({ state: "connecting" });
  return (
    <div className="flex h-full flex-col">
      <TerminalStatusLine status={status} onReconnect={() => setSession(session + 1)} />
      <TerminalView
        key={`${name}-${session}`}
        label={`Terminal in ${name}`}
        connect={(terminal) => connectShell(terminal, machineShell(name), setStatus)}
      />
    </div>
  );
}
