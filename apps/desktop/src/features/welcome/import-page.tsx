import { useNavigate } from "@tanstack/react-router";

import { Crumb, Page } from "@/shell/page";
import { PageHeading } from "@/ui/page-heading";

import { MigrationView } from "./migration-view";

/** File → Import from Another Engine…, any time after setup. */
export function ImportPage() {
  const navigate = useNavigate();
  return (
    <Page crumbs={<Crumb>Import</Crumb>}>
      <div className="mx-auto w-full max-w-[720px] px-5 pb-10">
        <PageHeading title="Import from another engine">
          <p className="m-0 text-14 text-ink-2">
            Images, volumes with their data, and containers with their ports, settings and Compose
            projects.
          </p>
        </PageHeading>
        <MigrationView
          doneLabel="Show containers"
          onDone={() => navigate({ to: "/containers" }).catch(() => undefined)}
        />
      </div>
    </Page>
  );
}
