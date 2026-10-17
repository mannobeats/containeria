import { Link } from "@tanstack/react-router";

import { buttonClass } from "@/ui/button-class";
import { EmptyState } from "@/ui/empty-state";

import { Crumb, Page } from "./page";

export function NotFound() {
  return (
    <Page crumbs={<Crumb>Not found</Crumb>}>
      <EmptyState
        title="This view doesn't exist"
        className="h-full"
        actions={
          <Link to="/containers" className={buttonClass()}>
            Go to containers
          </Link>
        }
      >
        The link may come from an older version of Containeria.
      </EmptyState>
    </Page>
  );
}
