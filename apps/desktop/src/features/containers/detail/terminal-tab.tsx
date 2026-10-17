import { IconCopy, IconRefresh } from "@tabler/icons-react";
import { useState } from "react";

import { copyText } from "@/lib/clipboard";
import { Banner } from "@/ui/banner";
import { Button } from "@/ui/button";
import { EmptyState } from "@/ui/empty-state";
import { Switch } from "@/ui/switch";
import { TerminalView } from "@/ui/terminal-view";
import { Tile } from "@/ui/tile";
import { Tip } from "@/ui/tooltip";

import { connectShell, type TerminalStatus } from "./use-terminal";

function StatusLine({ status, onReconnect }: { status: TerminalStatus; onReconnect: () => void }) {
  if (status.state === "failed") {
    return (
      <Banner
        tone="bad"
        className="mx-3 my-2"
        action={
          <Button size="sm" onClick={onReconnect}>
            Try again
          </Button>
        }
      >
        {status.message} If the image has no shell, turn on the debug shell.
      </Banner>
    );
  }
  if (status.state === "closed") {
    return (
      <Banner
        className="mx-3 my-2"
        action={
          <Button size="sm" onClick={onReconnect}>
            <IconRefresh />
            Reconnect
          </Button>
        }
      >
        The shell exited.
      </Banner>
    );
  }
  return null;
}

type LiveTerminalProps = {
  id: string;
  name: string;
  debug: boolean;
  onDebug: (debug: boolean) => void;
  onReconnect: () => void;
};

function LiveTerminal({ id, name, debug, onDebug, onReconnect }: LiveTerminalProps) {
  const [status, setStatus] = useState<TerminalStatus>({ state: "connecting" });
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-11 shrink-0 items-center gap-3 border-b-[0.5px] border-line pr-3 pl-5">
        <Tip label="Runs busybox beside the container, sharing its processes and network. Its files are under /proc/1/root.">
          <span className="flex items-center gap-2 text-12 text-ink-3">
            <Switch checked={debug} onCheckedChange={onDebug} label="Debug shell" />
            Debug shell
          </span>
        </Tip>
        <span className="text-12 text-ink-3" aria-live="polite">
          {status.state === "connecting" ? "Connecting…" : null}
        </span>
        <Button
          size="sm"
          className="ml-auto"
          onClick={() => copyText("Command", `docker exec -it ${name} sh`)}
        >
          <IconCopy />
          Copy command
        </Button>
      </div>
      <StatusLine status={status} onReconnect={onReconnect} />
      <TerminalView
        label={`Terminal in ${name}`}
        connect={(terminal) => connectShell(terminal, id, debug, setStatus)}
      />
    </div>
  );
}

/** A real shell in the container: bash when it has one, sh otherwise, busybox beside it on request. */
export function TerminalTab({ id, name, running }: { id: string; name: string; running: boolean }) {
  const [session, setSession] = useState(0);
  const [debug, setDebug] = useState(false);
  if (!running) {
    return (
      <EmptyState
        art={<Tile icon="machine" size="xl" />}
        title={`${name} isn't running`}
        className="h-full"
      >
        Start it to open a shell. The Files tab still works while it's stopped.
      </EmptyState>
    );
  }
  return (
    <LiveTerminal
      key={`${session}-${debug}`}
      id={id}
      name={name}
      debug={debug}
      onDebug={setDebug}
      onReconnect={() => setSession(session + 1)}
    />
  );
}
