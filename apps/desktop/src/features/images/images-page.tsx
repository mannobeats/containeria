import { Crumb, Page } from "@/shell/page";
import { EmptyState } from "@/ui/empty-state";
import { Tile } from "@/ui/tile";

export function ImagesPage() {
  return (
    <Page crumbs={<Crumb>Images</Crumb>}>
      <EmptyState art={<Tile icon="image" size="xl" />} title="Images" className="h-full" />
    </Page>
  );
}
