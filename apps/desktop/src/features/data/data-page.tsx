import { Crumb, Page } from "@/shell/page";
import { EmptyState } from "@/ui/empty-state";
import { Tile } from "@/ui/tile";

export function DataPage() {
  return (
    <Page crumbs={<Crumb>Data</Crumb>}>
      <EmptyState art={<Tile icon="data" size="xl" />} title="Data" className="h-full" />
    </Page>
  );
}
