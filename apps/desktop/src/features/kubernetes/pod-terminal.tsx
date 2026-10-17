import { IconCopy } from "@tabler/icons-react";
import { useState } from "react";

import { copyText } from "@/lib/clipboard";
import type { PodSummary } from "@/lib/ipc/bindings";
import { connectShell, type TerminalStatus } from "@/lib/ipc/connect-shell";
import { Button } from "@/ui/button";
import { EmptyState } from "@/ui/empty-state";
import { Select } from "@/ui/select";
import { TerminalStatusLine } from "@/ui/terminal-status";
import { TerminalView } from "@/ui/terminal-view";
import { Tile } from "@/ui/tile";

import { podShell } from "./api";
import { execCommand } from "./model";

type LiveTerminalProps = {
  pod: PodSummary;
  container: string | null;
  onContainer: (container: string) => void;
  onReconnect: () => void;
};

function LiveTerminal({ pod, container, onContainer, onReconnect }: LiveTerminalProps) {
  const [status, setStatus] = useState<TerminalStatus>({ state: "connecting" });
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-11 shrink-0 items-center gap-3 border-b-[0.5px] border-line pr-3 pl-5">
        {container === null ? null : (
          <Select
            label="Container"
            value={container}
            options={pod.containers.map((name) => ({ value: name, label: name }))}
            onChange={onContainer}
            className="w-48"
          />
        )}
        <span className="text-12 text-ink-3" aria-live="polite">
          {status.state === "connecting" ? "Connecting…" : null}
        </span>
        <Button
          size="sm"
          className="ml-auto"
          onClick={() => copyText("Command", execCommand(pod, container))}
        >
          <IconCopy />
          Copy command
        </Button>
      </div>
      <TerminalStatusLine
        status={status}
        onReconnect={onReconnect}
        hint="Images without a shell, such as distroless ones, can't open a terminal."
      />
      <TerminalView
        label={`Terminal in ${pod.name}`}
        connect={(terminal) => connectShell(terminal, podShell(pod, container), setStatus)}
      />
    </div>
  );
}

/** `kubectl exec -it` in the pod: bash when the container has it, sh otherwise. */
export function PodTerminal({ pod }: { pod: PodSummary }) {
  const [session, setSession] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  if (pod.status !== "Running") {
    return (
      <EmptyState
        art={<Tile icon="pod" size="xl" />}
        title={`${pod.name} isn't running`}
        className="h-full"
      >
        A terminal opens once its containers are running. Its logs and events say what's holding it
        up.
      </EmptyState>
    );
  }
  const container = pod.containers.length > 1 ? (picked ?? pod.containers[0] ?? null) : null;
  return (
    <LiveTerminal
      key={`${session}-${container ?? ""}`}
      pod={pod}
      container={container}
      onContainer={setPicked}
      onReconnect={() => setSession(session + 1)}
    />
  );
}
