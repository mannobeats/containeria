import { Link } from "@tanstack/react-router";

import { Button } from "@/ui/button";
import { EmptyState } from "@/ui/empty-state";

import { Crumb, Page } from "./page";

export function NotFound() {
  return (
    <Page crumbs={<Crumb>Not found</Crumb>}>
      <EmptyState
        title="This view doesn't exist"
        className="h-full"
        actions={
          <Link to="/containers" className="no-underline">
            <Button tabIndex={-1}>Go to containers</Button>
          </Link>
        }
      >
        The link may come from an older version of Containeria.
      </EmptyState>
    </Page>
  );
}
