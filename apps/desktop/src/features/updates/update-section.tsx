import type { AppUpdate } from "@/lib/ipc/bindings";
import { errorMessage } from "@/lib/ipc/errors";
import { Banner } from "@/ui/banner";
import { Button } from "@/ui/button";
import { Progress } from "@/ui/progress";

import { useInstallUpdate, useUpdateCheck } from "./api";
import { fetched, type Look, lookOf } from "./model";

function Summary({ look, version }: { look: Look; version: string | undefined }) {
  switch (look.state) {
    case "looking":
      return "Looking for a newer version…";
    case "failed":
      return "Contena couldn't look for a newer version.";
    case "newest":
      return `Contena ${version ?? ""} is the newest version.`;
    default:
      return (
        <>
          <b className="font-semibold">Contena {look.update.version} is available.</b> You have{" "}
          {version}.
        </>
      );
  }
}

function Offer({ update }: { update: AppUpdate }) {
  return (
    <>
      {update.notes ? (
        <p className="m-0 max-h-32 overflow-auto text-12 whitespace-pre-wrap text-ink-2">
          {update.notes}
        </p>
      ) : null}
      <p className="m-0 text-12 text-ink-3">
        Contena and its engine restart. Running containers stop, and those set to restart come back.
      </p>
    </>
  );
}

/**
 * Whether a newer Contena exists, and the button that installs it. Shown in Settings → About,
 * and asks the release server each time it opens.
 */
export function UpdateSection({ version }: { version: string | undefined }) {
  const check = useUpdateCheck();
  const { install, progress } = useInstallUpdate();
  const look = lookOf(check);
  if (install.isPending) {
    return (
      <div className="px-3.5 py-3">
        <p className="m-0 mb-2 text-13 text-ink">
          Installing the update. Contena restarts by itself when it is done.
        </p>
        <Progress label="Downloading the update" value={fetched(progress)} />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2.5 px-3.5 py-3">
      <div className="flex items-center gap-3">
        <p className="m-0 min-w-0 flex-1 text-13 text-ink">
          <Summary look={look} version={version} />
        </p>
        {look.state === "available" ? (
          <Button variant="brand" size="sm" onClick={() => install.mutate()}>
            Update and Restart
          </Button>
        ) : (
          <Button size="sm" loading={look.state === "looking"} onClick={() => check.refetch()}>
            Check Again
          </Button>
        )}
      </div>
      {look.state === "available" ? <Offer update={look.update} /> : null}
      {look.state === "failed" ? <Banner tone="bad">{errorMessage(look.error)}</Banner> : null}
      {install.isError ? (
        <Banner tone="bad">The update wasn't installed. {errorMessage(install.error)}</Banner>
      ) : null}
    </div>
  );
}
