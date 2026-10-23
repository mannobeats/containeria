import { IconRefresh } from "@tabler/icons-react";
import type { ReactNode } from "react";

import { errorMessage } from "@/lib/ipc/errors";
import { Crumb, Page } from "@/shell/page";
import { AppMark } from "@/ui/app-mark";
import { Button } from "@/ui/button";
import { EmptyState } from "@/ui/empty-state";

import { isServing, useEngineStatus } from "./api";
import { EngineOff } from "./engine-off";

/** Shows a view that lists what runs in the engine only while the engine runs. */
export function EngineGate({ title, children }: { title: string; children: ReactNode }) {
  const { data: status, error, isError, isFetching, refetch } = useEngineStatus();
  if (status && !isServing(status.phase)) {
    return (
      <Page crumbs={<Crumb>{title}</Crumb>}>
        <EngineOff phase={status.phase} />
      </Page>
    );
  }
  if (!status && isError) {
    return (
      <Page crumbs={<Crumb>{title}</Crumb>}>
        <EmptyState
          art={<AppMark size={48} />}
          title="Containeria couldn't check the engine"
          className="h-full"
          actions={
            <Button loading={isFetching} onClick={() => refetch()}>
              <IconRefresh />
              Try again
            </Button>
          }
        >
          {errorMessage(error)}
        </EmptyState>
      </Page>
    );
  }
  return children;
}
