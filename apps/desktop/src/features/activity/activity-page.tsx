import { Crumb, Page } from "@/shell/page";
import { EmptyState } from "@/ui/empty-state";
import { Tile } from "@/ui/tile";

export function ActivityPage() {
  return (
    <Page crumbs={<Crumb>Activity</Crumb>}>
      <EmptyState art={<Tile icon="activity" size="xl" />} title="Activity" className="h-full" />
    </Page>
  );
}
