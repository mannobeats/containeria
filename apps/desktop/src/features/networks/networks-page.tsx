import { Crumb, Page } from "@/shell/page";
import { EmptyState } from "@/ui/empty-state";
import { Tile } from "@/ui/tile";

export function NetworksPage() {
  return (
    <Page crumbs={<Crumb>Networks</Crumb>}>
      <EmptyState art={<Tile icon="network" size="xl" />} title="Networks" className="h-full" />
    </Page>
  );
}
