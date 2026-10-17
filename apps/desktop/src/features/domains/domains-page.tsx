import { Crumb, Page } from "@/shell/page";
import { EmptyState } from "@/ui/empty-state";
import { Tile } from "@/ui/tile";

export function DomainsPage() {
  return (
    <Page crumbs={<Crumb>Domains</Crumb>}>
      <EmptyState art={<Tile icon="domain" size="xl" />} title="Domains" className="h-full" />
    </Page>
  );
}
