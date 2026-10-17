import { Crumb, Page } from "@/shell/page";
import { EmptyState } from "@/ui/empty-state";
import { Tile } from "@/ui/tile";

export function MachinesPage() {
  return (
    <Page crumbs={<Crumb>Linux machines</Crumb>}>
      <EmptyState
        art={<Tile icon="machine" size="xl" />}
        title="Linux machines"
        className="h-full"
      />
    </Page>
  );
}
