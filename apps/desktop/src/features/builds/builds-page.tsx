import { IconHammer } from "@tabler/icons-react";
import { useState } from "react";

import { BuildSheet } from "@/features/images/build-sheet";
import { useImageSheet } from "@/features/images/sheet-store";
import { plural } from "@/lib/format";
import type { BuildRecord } from "@/lib/ipc/bindings";
import { useNow } from "@/lib/use-now";
import { Crumb, Page } from "@/shell/page";
import { Button } from "@/ui/button";
import { ConfirmSheet } from "@/ui/confirm-sheet";
import { EmptyState } from "@/ui/empty-state";
import { Lede, PageHeading } from "@/ui/page-heading";
import { HeadRow, Table } from "@/ui/table";
import { Tile } from "@/ui/tile";

import { useBuilds, useClearBuilds } from "./api";
import { BuildRow } from "./build-row";
import { runningCount, sortBuilds } from "./model";

function BuildTable({ builds }: { builds: BuildRecord[] }) {
  const running = runningCount(builds) > 0;
  const now = useNow(running);
  return (
    <Table label="Builds">
      <colgroup>
        <col />
        <col className="w-[120px]" />
        <col className="w-[150px]" />
        <col className="w-[140px]" />
        <col className="w-[140px]" />
        <col className="w-[52px]" />
      </colgroup>
      <HeadRow>
        <th>Name</th>
        <th>Status</th>
        <th>Started</th>
        <th>Cache</th>
        <th className="text-right!">Duration</th>
        <th>
          <span className="sr-only">Actions</span>
        </th>
      </HeadRow>
      <tbody>
        {sortBuilds(builds).map((build) => (
          <BuildRow key={build.id} build={build} now={now} />
        ))}
      </tbody>
    </Table>
  );
}

function ClearHistory({ disabled }: { disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const clear = useClearBuilds();
  return (
    <>
      <Button disabled={disabled} onClick={() => setOpen(true)}>
        Clear History…
      </Button>
      <ConfirmSheet
        open={open}
        onOpenChange={setOpen}
        title="Clear the build history?"
        action="Clear History"
        pending={clear.isPending}
        onConfirm={() => clear.mutate(undefined, { onSettled: () => setOpen(false) })}
      >
        Every build and its logs leave the history. The images they made stay.
      </ConfirmSheet>
    </>
  );
}

export function BuildsPage() {
  const { data: builds } = useBuilds();
  const openBuild = useImageSheet((state) => state.openBuild);
  const running = runningCount(builds);
  const build = (
    <Button variant="brand" onClick={() => openBuild()}>
      <IconHammer />
      Build Image…
    </Button>
  );
  return (
    <Page crumbs={<Crumb>Builds</Crumb>}>
      {builds?.length === 0 ? (
        <EmptyState
          art={<Tile icon="build" size="xl" />}
          title="No builds yet"
          className="h-full"
          actions={build}
        >
          Images built here, and with docker build or docker compose build in your terminal, show up
          with their logs while they run and after.
        </EmptyState>
      ) : (
        <>
          <PageHeading
            title="Builds"
            action={
              <span className="flex gap-2">
                <ClearHistory disabled={!builds || builds.length === running} />
                {build}
              </span>
            }
          >
            <Lede>
              {running > 0 ? <b>{plural(running, "build")} running. </b> : null}
              {plural(builds?.length ?? 0, "build")} in the engine's history.
            </Lede>
          </PageHeading>
          <div className="pb-10">{builds ? <BuildTable builds={builds} /> : null}</div>
        </>
      )}
      <BuildSheet />
    </Page>
  );
}
