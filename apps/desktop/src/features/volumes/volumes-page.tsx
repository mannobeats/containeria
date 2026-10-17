import { Crumb, Page } from "@/shell/page";
import { EmptyState } from "@/ui/empty-state";
import { Tile } from "@/ui/tile";

export function VolumesPage() {
  return (
    <Page crumbs={<Crumb>Volumes</Crumb>}>
      <EmptyState art={<Tile icon="volume" size="xl" />} title="Volumes" className="h-full" />
    </Page>
  );
}
