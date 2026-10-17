import { getRouteApi } from "@tanstack/react-router";

import { Crumb, Page } from "@/shell/page";
import { EmptyState } from "@/ui/empty-state";

const route = getRouteApi("/containers/$id");

export function ContainerPage() {
  const { id } = route.useParams();
  return (
    <Page crumbs={<Crumb>{id.slice(0, 12)}</Crumb>}>
      <EmptyState title="Container" className="h-full" />
    </Page>
  );
}
