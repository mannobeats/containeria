import { IconRefresh } from "@tabler/icons-react";

import type { TerminalStatus } from "@/lib/ipc/connect-shell";

import { Banner } from "./banner";
import { Button } from "./button";

type TerminalStatusLineProps = {
  status: TerminalStatus;
  onReconnect: () => void;
  /** Said after the error when the shell can't start, such as where else to get one. */
  hint?: string;
};

/** Why a terminal isn't live, with a way to start it again. Nothing while it's connecting or open. */
export function TerminalStatusLine({ status, onReconnect, hint }: TerminalStatusLineProps) {
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
        {status.message}
        {hint ? ` ${hint}` : null}
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
